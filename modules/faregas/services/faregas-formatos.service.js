const db = require('../../../config/database');
const PizZip = require('pizzip');
const Docxtemplater = require('docxtemplater');
const fs = require('fs');
const path = require('path');
const { VARIABLES_CATALOG } = require('./faregas-formatos.variables');
const { DOMParser, XMLSerializer } = require('@xmldom/xmldom');

const STORAGE_PATH = process.env.FAREGAS_FORMATOS_STORAGE_PATH || path.join(__dirname, '../../../../uploads/formatos');

// Ensure uploads directory exists
if (!fs.existsSync(STORAGE_PATH)) {
  fs.mkdirSync(STORAGE_PATH, { recursive: true });
}

function getParagraphTextAndMappings(pNode) {
    const wtElements = pNode.getElementsByTagName('w:t');
    let text = '';
    for (let i = 0; i < wtElements.length; i++) {
        text += (wtElements[i].textContent || '');
    }
    return text;
}

function extractDocumentStructure(xmlString, partName) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlString, 'text/xml');
    const pElements = doc.getElementsByTagName('w:p');
    
    const paragraphs = [];
    for (let i = 0; i < pElements.length; i++) {
        const pNode = pElements[i];
        const text = getParagraphTextAndMappings(pNode);
        if (text.trim().length > 0) {
            paragraphs.push({ part: partName, pIndex: i, text });
        }
    }
    return paragraphs;
}

function rebuildTemplateFromOriginal(originalPath, mappings, outputPath) {
    const content = fs.readFileSync(originalPath, 'binary');
    const zip = new PizZip(content);
    
    // Group mappings by part
    const mappingsByPart = {};
    for (const mapping of mappings) {
        if (!mapping.locator) continue; // might be advanced mode pre-mapped
        const part = mapping.locator.part;
        if (!mappingsByPart[part]) mappingsByPart[part] = [];
        mappingsByPart[part].push(mapping);
    }

    for (const part in mappingsByPart) {
        let xmlString = zip.file(part).asText();
        const parser = new DOMParser();
        const doc = parser.parseFromString(xmlString, 'text/xml');
        
        // Apply mappings for this part
        // Sort mappings in descending pIndex and offset to avoid shifting issues within the same paragraph
        // Actually, replacing from end to start within the same paragraph prevents offset shifting!
        const partMappings = mappingsByPart[part].sort((a, b) => {
            if (a.locator.pIndex !== b.locator.pIndex) return b.locator.pIndex - a.locator.pIndex;
            return b.locator.startOffset - a.locator.startOffset;
        });

        const pElements = doc.getElementsByTagName('w:p');

        for (const mapping of partMappings) {
            const { pIndex, startOffset, endOffset } = mapping.locator;
            const variable = mapping.variable;
            const pNode = pElements[pIndex];
            if (!pNode) continue;

            const wtElements = pNode.getElementsByTagName('w:t');
            const nodeMappings = [];
            for (let i = 0; i < wtElements.length; i++) {
                const node = wtElements[i];
                const t = node.textContent || '';
                for (let j = 0; j < t.length; j++) {
                    nodeMappings.push({ node, offset: j });
                }
            }

            if (startOffset < 0 || endOffset >= nodeMappings.length || startOffset > endOffset) continue;

            const startMap = nodeMappings[startOffset];
            const endMap = nodeMappings[endOffset];
            
            const startNode = startMap.node;
            const endNode = endMap.node;
            
            if (startNode === endNode) {
                const t = startNode.textContent;
                startNode.textContent = t.substring(0, startMap.offset) + '{{' + variable + '}}' + t.substring(endMap.offset + 1);
            } else {
                startNode.textContent = startNode.textContent.substring(0, startMap.offset) + '{{' + variable + '}}';
                for (let i = startOffset + 1; i < endOffset; i++) {
                    const map = nodeMappings[i];
                    if (map.node !== startNode && map.node !== endNode) {
                        map.node.textContent = '';
                    }
                }
                endNode.textContent = endNode.textContent.substring(endMap.offset + 1);
            }
        }

        const serializer = new XMLSerializer();
        zip.file(part, serializer.serializeToString(doc));
    }

    const buf = zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
    fs.writeFileSync(outputPath, buf);
}


const faregasFormatosService = {
  
  listarFormatos: async () => {
    const query = `
      SELECT f.id, f.codigo, f.nombre, f.motor, f.es_protegido, f.activo,
             (SELECT COUNT(*) FROM fg_certificado_formato_version v WHERE v.formato_id = f.id AND v.estado = 'VIGENTE') > 0 as tiene_version_vigente
      FROM fg_certificado_formato f
      ORDER BY f.id ASC
    `;
    const res = await db.query(query);
    return res.rows;
  },

  obtenerVersionesFormato: async (formatoId) => {
    const query = `
      SELECT id, version, configuracion, estado, vigente_desde, creado_en
      FROM fg_certificado_formato_version
      WHERE formato_id = $1
      ORDER BY version DESC
    `;
    const res = await db.query(query, [formatoId]);
    return res.rows;
  },

  crearFormato: async (nombre, codigo, motor) => {
    const query = `
      INSERT INTO fg_certificado_formato (nombre, codigo, motor, es_protegido, activo)
      VALUES ($1, $2, $3, false, true)
      RETURNING *
    `;
    const res = await db.query(query, [nombre, codigo, motor]);
    return res.rows[0];
  },

  guardarBorradorVersion: async (formatoId, fileData, originalName) => {
    if (!fileData) throw new Error('Archivo requerido');
    
    const formatoRes = await db.query('SELECT * FROM fg_certificado_formato WHERE id = $1', [formatoId]);
    if (formatoRes.rowCount === 0) throw new Error('Formato no encontrado');
    const formato = formatoRes.rows[0];
    
    if (formato.es_protegido) throw new Error('No se pueden subir plantillas a formatos protegidos por el sistema');
    
    // Verify it's a valid zip/docx
    let zip;
    try {
        zip = new PizZip(fileData);
    } catch(e) {
        throw new Error('El archivo no es un documento de Word (.docx) válido o está corrupto.');
    }

    // Ensure it has document.xml
    if (!zip.file('word/document.xml')) {
        throw new Error('El archivo ZIP no contiene la estructura de un DOCX (falta word/document.xml).');
    }

    // Version Concurrency using Transaction
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        await client.query('LOCK TABLE fg_certificado_formato_version IN EXCLUSIVE MODE');
        
        const verRes = await client.query('SELECT COALESCE(MAX(version), 0) + 1 as next_v FROM fg_certificado_formato_version WHERE formato_id = $1', [formatoId]);
        const nextVersion = verRes.rows[0].next_v;

        // Path: [codigo]/v[version]
        const versionDir = path.join(STORAGE_PATH, formato.codigo, `v${nextVersion}`);
        if (!fs.existsSync(versionDir)) {
            fs.mkdirSync(versionDir, { recursive: true });
        }

        const originalPath = path.join(versionDir, 'original.docx');
        const templatePath = path.join(versionDir, 'template.docx');
        fs.writeFileSync(originalPath, fileData);
        fs.writeFileSync(templatePath, fileData); // Initially, template is exactly original

        const storageKey = path.join(formato.codigo, `v${nextVersion}`).replace(/\\/g, '/'); // ensure forward slash

        // Check if there are ALREADY tags inside the DOCX (Advanced Mode)
        let initialMappings = [];
        const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });
        // Getting all tags
        const text = doc.getFullText();
        // A naive way to find tags {{something}}
        const regex = /\{\{([^}]+)\}\}/g;
        let match;
        const validKeys = VARIABLES_CATALOG.map(v => v.key);
        
        while ((match = regex.exec(text)) !== null) {
            const tag = match[1].trim();
            if (validKeys.includes(tag)) {
                if (!initialMappings.find(m => m.variable === tag)) {
                    initialMappings.push({
                        variable: tag,
                        sourceText: `{{ ${tag} }}`,
                        locator: null // Advanced mode, no locator
                    });
                }
            }
        }

        const insertQuery = `
          INSERT INTO fg_certificado_formato_version 
          (formato_id, version, archivo_ruta, configuracion, estado)
          VALUES ($1, $2, $3, $4, 'BORRADOR')
          RETURNING id, version, estado
        `;
        const res = await client.query(insertQuery, [
          formatoId,
          nextVersion,
          storageKey,
          JSON.stringify({ mappings: initialMappings })
        ]);

        await client.query('COMMIT');
        return res.rows[0];
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
  },

  obtenerEstructura: async (formatoId, versionId) => {
    const verRes = await db.query('SELECT archivo_ruta FROM fg_certificado_formato_version WHERE id = $1 AND formato_id = $2', [versionId, formatoId]);
    if (verRes.rowCount === 0) throw new Error('Versión no encontrada');
    
    const storageKey = verRes.rows[0].archivo_ruta;
    const originalPath = path.join(STORAGE_PATH, storageKey, 'original.docx');
    
    if (!fs.existsSync(originalPath)) throw new Error('Archivo original no encontrado en el servidor');
    
    const content = fs.readFileSync(originalPath, 'binary');
    const zip = new PizZip(content);
    
    const parts = ['word/document.xml'];
    for (let f in zip.files) {
        if (f.startsWith('word/header') || f.startsWith('word/footer')) {
            parts.push(f);
        }
    }

    let allParagraphs = [];
    for (const part of parts) {
        if (!zip.file(part)) continue;
        const xml = zip.file(part).asText();
        const paragraphs = extractDocumentStructure(xml, part);
        allParagraphs = allParagraphs.concat(paragraphs);
    }
    
    return allParagraphs;
  },

  guardarMappings: async (formatoId, versionId, mappings) => {
    const verRes = await db.query('SELECT archivo_ruta, estado FROM fg_certificado_formato_version WHERE id = $1 AND formato_id = $2', [versionId, formatoId]);
    if (verRes.rowCount === 0) throw new Error('Versión no encontrada');
    if (verRes.rows[0].estado !== 'BORRADOR') throw new Error('Solo se pueden editar mappings de una versión en BORRADOR');
    
    const storageKey = verRes.rows[0].archivo_ruta;
    const originalPath = path.join(STORAGE_PATH, storageKey, 'original.docx');
    const templatePath = path.join(STORAGE_PATH, storageKey, 'template.docx');
    
    // Rebuild the template
    rebuildTemplateFromOriginal(originalPath, mappings, templatePath);
    
    // Save to DB
    await db.query('UPDATE fg_certificado_formato_version SET configuracion = $1 WHERE id = $2', [
        JSON.stringify({ mappings }), versionId
    ]);

    return { success: true };
  },

  generarPreview: async (formatoId, versionId) => {
    const verRes = await db.query('SELECT archivo_ruta FROM fg_certificado_formato_version WHERE id = $1 AND formato_id = $2', [versionId, formatoId]);
    if (verRes.rowCount === 0) throw new Error('Versión no encontrada');
    
    const storageKey = verRes.rows[0].archivo_ruta;
    const templatePath = path.join(STORAGE_PATH, storageKey, 'template.docx');
    
    const content = fs.readFileSync(templatePath, 'binary');
    const zip = new PizZip(content);
    
    const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });
    
    // Build dummy data
    const dummyData = {};
    for (const v of VARIABLES_CATALOG) {
        const parts = v.key.split('.');
        if (parts.length === 2) {
            if (!dummyData[parts[0]]) dummyData[parts[0]] = {};
            dummyData[parts[0]][parts[1]] = v.demo;
        } else {
            dummyData[v.key] = v.demo;
        }
    }
    
    doc.render(dummyData);
    
    return doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' });
  },

  activarVersion: async (formatoId, versionId) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        
        const verRes = await client.query('SELECT estado FROM fg_certificado_formato_version WHERE id = $1 AND formato_id = $2 FOR UPDATE', [versionId, formatoId]);
        if (verRes.rowCount === 0) throw new Error('Versión no encontrada');
        if (verRes.rows[0].estado !== 'BORRADOR') throw new Error('La versión no está en estado BORRADOR');
        
        // Retire current VIGENTE
        await client.query(`
            UPDATE fg_certificado_formato_version 
            SET estado = 'RETIRADA' 
            WHERE formato_id = $1 AND estado = 'VIGENTE'
        `, [formatoId]);
        
        // Make this one VIGENTE
        await client.query(`
            UPDATE fg_certificado_formato_version 
            SET estado = 'VIGENTE', vigente_desde = NOW()
            WHERE id = $1
        `, [versionId]);
        
        await client.query('COMMIT');
        return { success: true };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
  },

  renderVersion: async (formatoVersionId, data) => {
    const verRes = await db.query('SELECT archivo_ruta, estado FROM fg_certificado_formato_version WHERE id = $1', [formatoVersionId]);
    if (verRes.rowCount === 0) throw new Error('Versión no encontrada');
    if (verRes.rows[0].estado !== 'VIGENTE') throw new Error('Solo se pueden emitir certificados con versiones VIGENTES');
    
    const storageKey = verRes.rows[0].archivo_ruta;
    const templatePath = path.join(STORAGE_PATH, storageKey, 'template.docx');
    
    if (!fs.existsSync(templatePath)) throw new Error('Plantilla no encontrada en el servidor');
    
    const content = fs.readFileSync(templatePath, 'binary');
    const zip = new PizZip(content);
    
    const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });
    doc.render(data);
    
    return doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' });
  }

};

module.exports = {
  faregasFormatosService
};
