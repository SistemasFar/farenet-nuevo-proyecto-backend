const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const db = require('../../../config/database');
const configService = require('../services/faregas-config.service');

const originalQuery = db.query;
const originalConnect = db.connect;
const frontendDir = path.join(__dirname, '../../../../farenetFrontend/src/modules/faregas/views/Configuracion/components');
const leer = (archivo) => fs.readFileSync(path.join(frontendDir, archivo), 'utf8');

test.afterEach(() => {
    db.query = originalQuery;
    db.connect = originalConnect;
});

test.after(() => db.end());

test('operación con formato ofrece Editar formato', () => {
    const fuente = leer('TabCertificadosBase.tsx');
    assert.match(fuente, /servicio\.formato_id[\s\S]*Editar formato/);
    assert.match(fuente, /setEditarFormato/);
});

test('operación sin formato ofrece Agregar formato', () => {
    const fuente = leer('TabCertificadosBase.tsx');
    assert.match(fuente, /servicio\.formato_id[\s\S]*Agregar formato/);
    assert.match(fuente, /setAsignarFormatoServicio/);
});

test('asignar existente actualiza únicamente la operación indicada dentro de una transacción', async () => {
    const consultas = [];
    const client = {
        query: async (sql, params = []) => {
            consultas.push({ sql: String(sql), params });
            if (String(sql).includes('SELECT * FROM fg_servicio')) {
                return { rowCount: 1, rows: [{ id: 40, codigo: 'OP_A', requiere_certificado: true }] };
            }
            if (String(sql).includes('SELECT id FROM fg_certificado_formato')) {
                return { rowCount: 1, rows: [{ id: 7 }] };
            }
            return { rowCount: 1, rows: [] };
        },
        release: () => {}
    };
    db.connect = async () => client;
    await configService.asignarFormatoAServicio(40, 7, 'SISTEMAS', '127.0.0.1');
    const update = consultas.find((consulta) => consulta.sql.includes('UPDATE fg_servicio SET formato_id'));
    assert.deepEqual(update.params, [7, 40]);
    assert(consultas.some((consulta) => consulta.sql === 'COMMIT'));
});

test('crear formato dinámico se ejecuta solo por acción y luego se asigna', () => {
    const fuente = leer('FormatoAsignadorModal.tsx');
    assert.match(fuente, /onSubmit=\{crearNuevo\}/);
    assert.match(fuente, /motor: 'HTML_DINAMICO'/);
    assert.match(fuente, /crearFormato[\s\S]*asignarFormato/);
    assert.doesNotMatch(fuente, /useEffect\([\s\S]{0,300}crearFormato/);
});

test('crear variante de protegido crea formato hijo y lo asigna atómicamente', async () => {
    const consultas = [];
    const client = {
        query: async (sql, params = []) => {
            consultas.push({ sql: String(sql), params });
            if (String(sql).includes('SELECT * FROM fg_servicio')) {
                return { rowCount: 1, rows: [{ id: 40, codigo: 'OP_A', requiere_certificado: true, formato_id: null }] };
            }
            if (String(sql).includes('SELECT * FROM fg_certificado_formato')) {
                return { rowCount: 1, rows: [{ id: 2, codigo: 'GNV_ANUAL', nombre: 'GNV Anual', es_protegido: true, motor: 'SISTEMA' }] };
            }
            if (String(sql).includes('INSERT INTO fg_certificado_formato')) {
                return { rowCount: 1, rows: [{ id: 90, codigo: 'GNV_ANUAL_OP_A', nombre: 'GNV Anual (OP_A)', motor: 'HTML_DINAMICO', formato_padre_id: 2, activo: true }] };
            }
            return { rowCount: 1, rows: [] };
        },
        release: () => {}
    };
    db.connect = async () => client;
    const variante = await configService.crearVarianteParaServicio(40, 2, 'SISTEMAS', '127.0.0.1');
    assert.equal(variante.formato_padre_id, 2);
    const insert = consultas.find((consulta) => consulta.sql.includes('INSERT INTO fg_certificado_formato'));
    assert.equal(insert.params[3], 2);
    assert(consultas.some((consulta) => consulta.sql === 'COMMIT'));
});

test('formato compartido informa operaciones y efecto sobre futuras emisiones', () => {
    const fuente = leer('FormatoDetalleModal.tsx');
    assert.match(fuente, /obtenerOperacionesPorFormato/);
    assert.match(fuente, /Este formato es utilizado por \{operacionesVinculadas\.length\} operaciones/);
    assert.match(fuente, /futuras emisiones de todas ellas/);
    assert.match(fuente, /operacion\.codigo[\s\S]*operacion\.nombre/);
});

test('desdoblar formato reasigna solo la operación elegida', async () => {
    const consultas = [];
    const client = {
        query: async (sql, params = []) => {
            consultas.push({ sql: String(sql), params });
            if (String(sql).includes('SELECT * FROM fg_servicio')) {
                return { rowCount: 1, rows: [{ id: 41, codigo: 'OP_B', requiere_certificado: true, formato_id: 8 }] };
            }
            if (String(sql).includes('SELECT * FROM fg_certificado_formato')) {
                return { rowCount: 1, rows: [{ id: 8, codigo: 'COMPARTIDO', nombre: 'Compartido', es_protegido: false, motor: 'HTML_DINAMICO' }] };
            }
            if (String(sql).includes('INSERT INTO fg_certificado_formato')) {
                return { rowCount: 1, rows: [{ id: 91, formato_padre_id: 8 }] };
            }
            return { rowCount: 1, rows: [] };
        },
        release: () => {}
    };
    db.connect = async () => client;
    await configService.crearVarianteParaServicio(41, null, 'SISTEMAS', '127.0.0.1');
    const updates = consultas.filter((consulta) => consulta.sql.includes('UPDATE fg_servicio SET formato_id'));
    assert.equal(updates.length, 1);
    assert.deepEqual(updates[0].params, [91, 41]);
});

test('formato protegido conserva bloqueadas las acciones mutables', () => {
    const detalle = leer('FormatoDetalleModal.tsx');
    const servicio = fs.readFileSync(path.join(__dirname, '../services/faregas-formatos.service.js'), 'utf8');
    assert.match(detalle, /!formato\.es_protegido && formato\.motor === 'HTML_DINAMICO'/);
    assert.match(detalle, /!formato\.es_protegido && version\.estado === 'BORRADOR'/);
    assert.match(servicio, /if \(formato\.es_protegido\)/);
});

test('detalle conserva estados y administración de versiones', () => {
    const fuente = leer('FormatoDetalleModal.tsx');
    for (const evidencia of ['listarVersiones', 'BORRADOR', 'VIGENTE', 'RETIRADA', 'Preview', 'Nueva versión HTML', 'Subir versión DOCX', 'Activar versión', 'Eliminar']) {
        assert.match(fuente, new RegExp(evidencia));
    }
});

test('los editores HTML y DOCX históricos siguen accesibles desde el mismo detalle', () => {
    const fuente = leer('FormatoDetalleModal.tsx');
    assert.match(fuente, /FormatoHtmlVariablesEditor/);
    assert.match(fuente, /FormatosVariablesEditor/);
    assert.match(fuente, /Configurar variables/);
});

test('FORMATOS ya no está en navegación activa y TabFormatos permanece preservado', () => {
    const catalogo = leer('TabCatalogo.tsx');
    assert.doesNotMatch(catalogo, /id: 'FORMATOS'/);
    assert.doesNotMatch(catalogo, /<TabFormatos/);
    assert.equal(fs.existsSync(path.join(frontendDir, 'TabFormatos.tsx')), true);
});
