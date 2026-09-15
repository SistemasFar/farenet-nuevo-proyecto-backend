const db = require('../../../config/database');
const PizZip = require('pizzip');
const Docxtemplater = require('docxtemplater');
const fs = require('fs');
const path = require('path');
const {
  VARIABLES_CATALOG,
  obtenerVariablesPersonalizadas,
  obtenerCatalogoVariables
} = require('./faregas-formatos.variables');
const { PLANTILLA_FAREGAS_HTML } = require('./faregas-formatos.templates');
const { convertirDocxAHtml } = require('./faregas-formatos-word');
const {
    normalizarHtmlEditor,
    renderizarHtml,
    variablesDesconocidas
} = require('./faregas-formatos-html');
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
      SELECT f.id, f.codigo, f.nombre, f.motor, f.es_protegido, f.activo, f.formato_padre_id,
             p.nombre as formato_padre_nombre, p.codigo as formato_padre_codigo,
             (SELECT COUNT(*) FROM fg_certificado_formato_version v WHERE v.formato_id = f.id AND v.estado = 'VIGENTE') > 0 as tiene_version_vigente
      FROM fg_certificado_formato f
      LEFT JOIN fg_certificado_formato p ON f.formato_padre_id = p.id
      ORDER BY COALESCE(f.formato_padre_id, f.id) ASC, f.id ASC
    `;
    const res = await db.query(query);
    return res.rows;
  },

  obtenerVersionesFormato: async (formatoId) => {
    const query = `
      SELECT id, version, configuracion, estado, vigente_desde, creado_en, motor
      FROM fg_certificado_formato_version
      WHERE formato_id = $1
      ORDER BY version DESC
    `;
    const res = await db.query(query, [formatoId]);
    return res.rows;
  },

  obtenerOperacionesPorFormato: async (formatoId) => {
    const query = `
      SELECT id, codigo, nombre, activo
      FROM fg_servicio
      WHERE formato_id = $1
      ORDER BY codigo ASC
    `;
    const res = await db.query(query, [formatoId]);
    return res.rows;
  },

  crearFormato: async (nombre, codigo, motor, formato_padre_id = null) => {
    if (formato_padre_id) {
        const pRes = await db.query('SELECT es_protegido, motor FROM fg_certificado_formato WHERE id = $1', [formato_padre_id]);
        if (pRes.rowCount === 0) throw new Error('El formato base especificado no existe');
        const padre = pRes.rows[0];
        if (!padre.es_protegido || padre.motor !== 'SISTEMA') {
            throw new Error('El formato base debe ser un formato protegido del sistema');
        }
        motor = 'HTML_DINAMICO'; // Forzar para variantes
    }
    const query = `
      INSERT INTO fg_certificado_formato (nombre, codigo, motor, es_protegido, activo, formato_padre_id)
      VALUES ($1, $2, $3, false, true, $4)
      RETURNING *
    `;
    const res = await db.query(query, [nombre, codigo, motor, formato_padre_id]);
    return res.rows[0];
  },
  
  cambiarEstado: async (id) => {
      const fRes = await db.query('SELECT es_protegido, activo FROM fg_certificado_formato WHERE id = $1', [id]);
      if (fRes.rowCount === 0) throw new Error('Formato no encontrado');
      const formato = fRes.rows[0];
      
      if (formato.es_protegido) throw new Error('No se pueden desactivar formatos protegidos por el sistema');
      
      if (formato.activo) {
          // Intentando desactivar, verificar si hay operaciones (servicios) activas que lo referencien
          const sRes = await db.query("SELECT codigo, nombre FROM fg_servicio WHERE formato_id = $1 AND activo = true", [id]);
          if (sRes.rowCount > 0) {
              const ops = sRes.rows.map(r => '- ' + r.codigo + ' — ' + r.nombre).join('\n');
              throw new Error(`No se puede desactivar el formato porque está siendo utilizado por las siguientes operaciones activas:\n\n${ops}\n\nDesactiva o cambia primero esas operaciones.`);
          }
      }
      
      const query = `UPDATE fg_certificado_formato SET activo = NOT activo WHERE id = $1 RETURNING *`;
      const res = await db.query(query, [id]);
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
          (formato_id, version, archivo_ruta, configuracion, estado, motor)
          VALUES ($1, $2, $3, $4, 'BORRADOR', 'DOCX_DINAMICO')
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

  crearBorradorHtml: async (formatoId, origen = 'ULTIMA_VERSION') => {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const formatoRes = await client.query(
        'SELECT id, motor, es_protegido FROM fg_certificado_formato WHERE id = $1 FOR UPDATE',
        [formatoId]
      );
      if (formatoRes.rowCount === 0) throw new Error('Formato no encontrado');
      if (formatoRes.rows[0].es_protegido) throw new Error('No se pueden crear versiones en formatos protegidos por el sistema');
      if (formatoRes.rows[0].motor !== 'HTML_DINAMICO') throw new Error('El formato no utiliza el motor HTML_DINAMICO');

      const versionRes = await client.query(
        'SELECT COALESCE(MAX(version), 0) + 1 AS siguiente FROM fg_certificado_formato_version WHERE formato_id = $1',
        [formatoId]
      );
      const anteriorRes = await client.query(
        `SELECT configuracion
         FROM fg_certificado_formato_version
         WHERE formato_id = $1 AND motor = 'HTML_DINAMICO'
         ORDER BY version DESC
         LIMIT 1`,
        [formatoId]
      );
      const usarPlantillaBase = String(origen).toUpperCase() === 'PLANTILLA_FAREGAS';
      const configuracion = usarPlantillaBase
        ? { html: PLANTILLA_FAREGAS_HTML, variables_personalizadas: [], variables_usadas: [] }
        : anteriorRes.rows[0]?.configuracion || { html: PLANTILLA_FAREGAS_HTML, variables_personalizadas: [], variables_usadas: [] };
      const insert = await client.query(
        `INSERT INTO fg_certificado_formato_version
           (formato_id, version, archivo_ruta, configuracion, estado, motor)
         VALUES ($1, $2, 'HTML', $3, 'BORRADOR', 'HTML_DINAMICO')
         RETURNING id, version, estado, motor, configuracion`,
        [formatoId, versionRes.rows[0].siguiente, configuracion]
      );
      await client.query('COMMIT');
      return insert.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  crearBorradorHtmlDesdeWord: async (formatoId, archivoBuffer, nombreArchivo) => {
    const convertido = await convertirDocxAHtml(archivoBuffer, nombreArchivo);
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const formatoRes = await client.query(
        'SELECT id, motor, es_protegido FROM fg_certificado_formato WHERE id = $1 FOR UPDATE',
        [formatoId]
      );
      if (formatoRes.rowCount === 0) throw new Error('Formato no encontrado');
      if (formatoRes.rows[0].es_protegido) throw new Error('No se pueden crear versiones en formatos protegidos por el sistema');
      if (formatoRes.rows[0].motor !== 'HTML_DINAMICO') throw new Error('El formato no utiliza el motor HTML_DINAMICO');

      const versionRes = await client.query(
        'SELECT COALESCE(MAX(version), 0) + 1 AS siguiente FROM fg_certificado_formato_version WHERE formato_id = $1',
        [formatoId]
      );
      const configuracion = {
        html: convertido.html,
        variables_personalizadas: [],
        variables_usadas: [],
        importacion_word: {
          nombre_original: String(nombreArchivo || 'documento.docx').slice(0, 255),
          advertencias: convertido.advertencias,
          convertido_en: new Date().toISOString()
        }
      };
      const insert = await client.query(
        `INSERT INTO fg_certificado_formato_version
           (formato_id, version, archivo_ruta, configuracion, estado, motor)
         VALUES ($1, $2, 'HTML_IMPORTADO_WORD', $3, 'BORRADOR', 'HTML_DINAMICO')
         RETURNING id, version, estado, motor, configuracion`,
        [formatoId, versionRes.rows[0].siguiente, configuracion]
      );
      await client.query('COMMIT');
      return { version: insert.rows[0], advertencias: convertido.advertencias };
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

  eliminarVersion: async (formatoId, versionId) => {
    const verRes = await db.query('SELECT estado FROM fg_certificado_formato_version WHERE id = $1 AND formato_id = $2', [versionId, formatoId]);
    if (verRes.rowCount === 0) throw new Error('Versión no encontrada');
    if (verRes.rows[0].estado === 'VIGENTE') throw new Error('No se puede eliminar una versión VIGENTE. Desactiva o activa otra versión primero.');
    await db.query('DELETE FROM fg_certificado_formato_version WHERE id = $1', [versionId]);
    return { success: true };
},
guardarConfiguracion: async (formatoId, versionId, configuracion) => {
    const verRes = await db.query('SELECT archivo_ruta, estado, motor FROM fg_certificado_formato_version WHERE id = $1 AND formato_id = $2', [versionId, formatoId]);
    if (verRes.rowCount === 0) throw new Error('Versión no encontrada');
    if (verRes.rows[0].estado !== 'BORRADOR') throw new Error('Solo se pueden editar una versión en BORRADOR');
    
    // Security sanitization (extra layer)
    if (configuracion.html) {
        configuracion.html = configuracion.html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
        configuracion.html = normalizarHtmlEditor(configuracion.html);
    }
    configuracion.variables_personalizadas = obtenerVariablesPersonalizadas(configuracion);
    
    await db.query('UPDATE fg_certificado_formato_version SET configuracion = $1 WHERE id = $2', [JSON.stringify(configuracion), versionId]);
    return { success: true };
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
    const verRes = await db.query('SELECT archivo_ruta, configuracion, motor FROM fg_certificado_formato_version WHERE id = $1 AND formato_id = $2', [versionId, formatoId]);
    if (verRes.rowCount === 0) throw new Error('Versión no encontrada');
    const motorVersion = verRes.rows[0].motor || 'DOCX_DINAMICO';
    let config = verRes.rows[0].configuracion || {};
    if (typeof config === 'string') config = JSON.parse(config);
    
    // Build dummy data
    const dummyData = {};
    for (const v of obtenerCatalogoVariables(config)) {
        const parts = v.key.split('.');
        if (parts.length === 2) {
            if (!dummyData[parts[0]]) dummyData[parts[0]] = {};
            dummyData[parts[0]][parts[1]] = v.demo;
        } else {
            dummyData[v.key] = v.demo;
        }
    }

    if (motorVersion === 'HTML_DINAMICO') {
        const html = renderizarHtml(config?.html || '', dummyData);
        
        return { tipo: 'HTML_DINAMICO', data: html };
    }

    // Default to DOCX_DINAMICO
    const storageKey = verRes.rows[0].archivo_ruta;
    const templatePath = path.join(STORAGE_PATH, storageKey, 'template.docx');
    
    if (!fs.existsSync(templatePath)) throw new Error('No se encontró archivo docx de la versión');
    const content = fs.readFileSync(templatePath, 'binary');
    const zip = new PizZip(content);
    const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });
    
    doc.render(dummyData);
    return { tipo: 'DOCX_DINAMICO', data: doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' }) };
  },

  activarVersion: async (formatoId, versionId) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        
        const formatoRes = await client.query(
            'SELECT activo FROM fg_certificado_formato WHERE id = $1 FOR UPDATE',
            [formatoId]
        );
        if (formatoRes.rowCount === 0) throw new Error('Formato no encontrado');
        if (!formatoRes.rows[0].activo) throw new Error('No se puede activar una versión de un formato INACTIVO');

        const verRes = await client.query(
            'SELECT estado, motor, configuracion FROM fg_certificado_formato_version WHERE id = $1 AND formato_id = $2 FOR UPDATE',
            [versionId, formatoId]
        );
        if (verRes.rowCount === 0) throw new Error('Versión no encontrada');
        if (verRes.rows[0].estado !== 'BORRADOR') throw new Error('La versión no está en estado BORRADOR');

        let configuracion = verRes.rows[0].configuracion || {};
        if (typeof configuracion === 'string') configuracion = JSON.parse(configuracion);
        const permitidas = obtenerCatalogoVariables(configuracion).map((variable) => variable.key);
        const desconocidas = verRes.rows[0].motor === 'HTML_DINAMICO'
            ? variablesDesconocidas(configuracion.html || '', permitidas)
            : (configuracion.mappings || [])
                .map((mapping) => String(mapping.variable || '').trim())
                .filter((key) => key && !permitidas.includes(key));
        if (desconocidas.length > 0) {
            throw new Error(`La versión contiene variables desconocidas: ${[...new Set(desconocidas)].join(', ')}`);
        }
        
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

  desactivarVersion: async (formatoId, versionId) => {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const versionRes = await client.query(
        `SELECT v.estado, f.es_protegido
         FROM fg_certificado_formato_version v
         JOIN fg_certificado_formato f ON f.id = v.formato_id
         WHERE v.id = $1 AND v.formato_id = $2
         FOR UPDATE OF v`,
        [versionId, formatoId]
      );
      if (versionRes.rowCount === 0) throw new Error('Versión no encontrada');
      if (versionRes.rows[0].es_protegido) throw new Error('No se pueden desactivar versiones de formatos protegidos por el sistema');
      if (versionRes.rows[0].estado !== 'VIGENTE') throw new Error('Solo se puede desactivar una versión VIGENTE');

      await client.query(
        `UPDATE fg_certificado_formato_version
         SET estado = 'RETIRADA'
         WHERE id = $1 AND formato_id = $2`,
        [versionId, formatoId]
      );
      await client.query('COMMIT');
      return { success: true };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  renderVersion: async (formatoVersionId, data, allowBorrador = false) => {
    const verRes = await db.query(
      'SELECT archivo_ruta, configuracion, estado, motor FROM fg_certificado_formato_version WHERE id = $1',
      [formatoVersionId]
    );
    if (verRes.rowCount === 0) throw new Error('Versión no encontrada');
    if (verRes.rows[0].estado !== 'VIGENTE' && !(allowBorrador && verRes.rows[0].estado === 'BORRADOR')) {
        throw new Error('Solo se pueden emitir certificados con versiones VIGENTES');
    }

    const motorVersion = verRes.rows[0].motor || 'DOCX_DINAMICO';
    if (motorVersion === 'HTML_DINAMICO') {
      let configuracion = verRes.rows[0].configuracion || {};
      if (typeof configuracion === 'string') configuracion = JSON.parse(configuracion);
      return {
        tipo: 'HTML_DINAMICO',
        data: renderizarHtml(configuracion.html || '', data)
      };
    }
    
    const storageKey = verRes.rows[0].archivo_ruta;
    const templatePath = path.join(STORAGE_PATH, storageKey, 'template.docx');
    
    if (!fs.existsSync(templatePath)) throw new Error('Plantilla no encontrada en el servidor');
    
    const content = fs.readFileSync(templatePath, 'binary');
    const zip = new PizZip(content);
    
    const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });
    doc.render(data);
    
    return {
      tipo: 'DOCX_DINAMICO',
      data: doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' })
    };
  }

};

module.exports = {
  faregasFormatosService
};
