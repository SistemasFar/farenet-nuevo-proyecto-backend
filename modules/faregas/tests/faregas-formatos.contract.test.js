const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const db = require('../../../config/database');
const { faregasFormatosService } = require('../services/faregas-formatos.service');
const configService = require('../services/faregas-config.service');
const {
    sanitizarHtmlDocumental,
    normalizarHtmlEditor,
    renderizarHtml,
    variablesDesconocidas
} = require('../services/faregas-formatos-html');
const { VARIABLES_CATALOG, obtenerCatalogoVariables } = require('../services/faregas-formatos.variables');
const { PLANTILLA_FAREGAS_HTML } = require('../services/faregas-formatos.templates');
const { convertirDocxAHtml } = require('../services/faregas-formatos-word');
const { Document, Packer, Paragraph, Table, TableCell, TableRow } = require('docx');

const originalQuery = db.query;
const originalConnect = db.connect;

test.after(() => db.end());

test.afterEach(() => {
    db.query = originalQuery;
    db.connect = originalConnect;
});

test('editor HTML normaliza, cambia y conserva fallback incluso en slot vacío', () => {
    const normalizado = normalizarHtmlEditor('<span data-faregas-slot="taller.nombre">CHARING S.A.C.</span><table><tr><td data-faregas-var="empresa.telefono"></td></tr></table>');
    assert.match(normalizado, /data-faregas-var="taller\.nombre"/);
    assert.match(normalizado, /data-faregas-fallback="CHARING S\.A\.C\."/);
    assert.doesNotMatch(normalizado, /data-faregas-slot/);
    assert.match(normalizado, /data-faregas-var="empresa\.telefono" data-faregas-fallback=""/);

    const cambiado = normalizado.replace('data-faregas-var="taller.nombre"', 'data-faregas-var="empresa.razon_social"');
    const restaurado = cambiado.replace(/ data-faregas-var="empresa\.razon_social"/, '').replace(/ data-faregas-fallback="CHARING S\.A\.C\."/, '');
    assert.match(restaurado, />CHARING S\.A\.C\.<\/span>/);
});

test('plantilla HTML inicial conserva hoja A4, tabla y variables FAREGAS', () => {
    assert.match(PLANTILLA_FAREGAS_HTML, /width:\s*210mm/);
    assert.match(PLANTILLA_FAREGAS_HTML, /data-faregas-var="certificado\.titulo"/);
    assert.match(PLANTILLA_FAREGAS_HTML, /data-faregas-var="taller\.nombre"/);
    assert.match(PLANTILLA_FAREGAS_HTML, /class="tabla-info"/);
});

test('importación Word convierte texto y tablas a un documento HTML editable', async () => {
    const documento = new Document({
        sections: [{
            children: [
                new Paragraph('CERTIFICADO IMPORTADO'),
                new Table({ rows: [new TableRow({ children: [new TableCell({ children: [new Paragraph('Dato Word')] })] })] })
            ]
        }]
    });
    const resultado = await convertirDocxAHtml(await Packer.toBuffer(documento), 'modelo.docx');
    assert.match(resultado.html, /CERTIFICADO IMPORTADO/);
    assert.match(resultado.html, /Dato Word/);
    assert.match(resultado.html, /documento-certificado/);
    assert.match(resultado.html, /<table/);
});

test('catálogo admite variables personalizadas declaradas sin aceptar claves arbitrarias', () => {
    const catalogo = obtenerCatalogoVariables({
        variables_personalizadas: [
            { key: 'personalizado.nombre_inspector', label: 'Nombre inspector' },
            { key: 'desconocida.valor', label: 'No permitida' },
            { key: 'personalizado.nombre_inspector', label: 'Duplicada' }
        ]
    });
    assert(catalogo.some((variable) => variable.key === 'personalizado.nombre_inspector'));
    assert(!catalogo.some((variable) => variable.key === 'desconocida.valor'));
    assert.equal(catalogo.filter((variable) => variable.key === 'personalizado.nombre_inspector').length, 1);
});

test('render HTML usa la variable canónica de la versión y resuelve variables Taller legítimas', () => {
    const html = '<h1 data-faregas-var="certificado.titulo" data-faregas-fallback="Título fijo">{{certificado.titulo}}</h1><p>{{empresa.direccion}}</p>';
    const render = renderizarHtml(html, {
        certificado: { titulo: 'CERTIFICADO TALLER' },
        empresa: { direccion: 'Av. Prueba 123' }
    });
    assert.match(render, />CERTIFICADO TALLER<\/h1>/);
    assert.match(render, /<p>Av\. Prueba 123<\/p>/);
    const permitidas = VARIABLES_CATALOG.map((variable) => variable.key);
    assert.deepEqual(variablesDesconocidas(html, permitidas), []);
    assert.deepEqual(variablesDesconocidas('<b data-faregas-var="variable.inexistente"></b>', permitidas), ['variable.inexistente']);
});

test('sanitización documental elimina scripts, eventos y URLs ejecutables', () => {
    const inseguro = '<p onclick="alert(1)">Seguro<script>alert(2)</script><a href="javascript:alert(3)" onerror="alert(4)">enlace</a></p>';
    const limpio = sanitizarHtmlDocumental(inseguro);
    assert.doesNotMatch(limpio, /<script|onclick|onerror|javascript:/i);
    assert.match(limpio, /Seguro/);
    assert.match(limpio, /enlace/);
});

test('formato libre se desactiva/reactiva, protegido y operación activa bloquean', async () => {
    const respuestas = [
        { rowCount: 1, rows: [{ es_protegido: false, activo: true }] },
        { rowCount: 0, rows: [] },
        { rowCount: 1, rows: [{ activo: false }] },
        { rowCount: 1, rows: [{ es_protegido: false, activo: false }] },
        { rowCount: 1, rows: [{ activo: true }] }
    ];
    db.query = async () => respuestas.shift();
    assert.equal((await faregasFormatosService.cambiarEstado(10)).activo, false);
    assert.equal((await faregasFormatosService.cambiarEstado(10)).activo, true);

    db.query = async () => ({ rowCount: 1, rows: [{ es_protegido: true, activo: true }] });
    await assert.rejects(() => faregasFormatosService.cambiarEstado(1), /protegidos/);

    let consulta = 0;
    db.query = async () => (++consulta === 1
        ? { rowCount: 1, rows: [{ es_protegido: false, activo: true }] }
        : { rowCount: 1, rows: [{ codigo: 'TALLER_GLP', nombre: 'Taller GLP' }] });
    await assert.rejects(() => faregasFormatosService.cambiarEstado(6), /TALLER_GLP.*Taller GLP/s);
});

test('activar versión retira la vigente anterior y deja una sola VIGENTE', async () => {
    const consultas = [];
    const client = {
        query: async (sql) => {
            consultas.push(String(sql));
            if (String(sql).includes('SELECT activo')) return { rowCount: 1, rows: [{ activo: true }] };
            if (String(sql).includes('SELECT estado, motor')) {
                return { rowCount: 1, rows: [{ estado: 'BORRADOR', motor: 'HTML_DINAMICO', configuracion: { html: '<b data-faregas-var="taller.nombre"></b>' } }] };
            }
            return { rowCount: 1, rows: [] };
        },
        release: () => {}
    };
    db.connect = async () => client;
    await faregasFormatosService.activarVersion(6, 14);
    assert(consultas.some((sql) => sql.includes("SET estado = 'RETIRADA'") && sql.includes("estado = 'VIGENTE'")));
    assert(consultas.some((sql) => sql.includes("SET estado = 'VIGENTE'")));
    assert.equal(consultas.filter((sql) => sql.includes('COMMIT')).length, 1);
});

test('desactivar versión cambia únicamente una VIGENTE a RETIRADA', async () => {
    const consultas = [];
    const client = {
        query: async (sql) => {
            consultas.push(String(sql));
            if (String(sql).includes('SELECT v.estado, f.es_protegido')) {
                return { rowCount: 1, rows: [{ estado: 'VIGENTE', es_protegido: false }] };
            }
            return { rowCount: 1, rows: [] };
        },
        release: () => {}
    };
    db.connect = async () => client;
    await faregasFormatosService.desactivarVersion(6, 14);
    assert(consultas.some((sql) => sql.includes("SET estado = 'RETIRADA'") && sql.includes('WHERE id = $1')));
    assert.equal(consultas.filter((sql) => sql.includes('COMMIT')).length, 1);
});

test('la siguiente versión HTML se crea solo mediante acción explícita y como BORRADOR', async () => {
    const consultas = [];
    const client = {
        query: async (sql, params = []) => {
            consultas.push({ sql: String(sql), params });
            if (String(sql).includes('SELECT id, motor, es_protegido')) {
                return { rowCount: 1, rows: [{ id: 6, motor: 'HTML_DINAMICO', es_protegido: false }] };
            }
            if (String(sql).includes('COALESCE(MAX(version)')) return { rowCount: 1, rows: [{ siguiente: 4 }] };
            if (String(sql).includes('SELECT configuracion')) return { rowCount: 1, rows: [{ configuracion: { html: '<p>Base</p>' } }] };
            if (String(sql).includes('INSERT INTO fg_certificado_formato_version')) {
                return { rowCount: 1, rows: [{ id: 15, version: 4, estado: 'BORRADOR', motor: 'HTML_DINAMICO' }] };
            }
            return { rowCount: 1, rows: [] };
        },
        release: () => {}
    };
    db.connect = async () => client;
    const version = await faregasFormatosService.crearBorradorHtml(6);
    assert.equal(version.estado, 'BORRADOR');
    assert.equal(version.motor, 'HTML_DINAMICO');
    const insert = consultas.find((consulta) => consulta.sql.includes('INSERT INTO fg_certificado_formato_version'));
    assert.match(insert.sql, /'BORRADOR'/);
    assert.match(insert.sql, /'HTML_DINAMICO'/);
});

test('crear versión desde plantilla ignora el contenido anterior y usa el modelo FAREGAS', async () => {
    let configuracionInsertada;
    const client = {
        query: async (sql, params = []) => {
            if (String(sql).includes('SELECT id, motor, es_protegido')) {
                return { rowCount: 1, rows: [{ id: 6, motor: 'HTML_DINAMICO', es_protegido: false }] };
            }
            if (String(sql).includes('COALESCE(MAX(version)')) return { rowCount: 1, rows: [{ siguiente: 5 }] };
            if (String(sql).includes('SELECT configuracion')) return { rowCount: 1, rows: [{ configuracion: { html: '<p>Diseño anterior</p>' } }] };
            if (String(sql).includes('INSERT INTO fg_certificado_formato_version')) {
                configuracionInsertada = params[2];
                return { rowCount: 1, rows: [{ id: 16, version: 5, estado: 'BORRADOR', motor: 'HTML_DINAMICO', configuracion: params[2] }] };
            }
            return { rowCount: 1, rows: [] };
        },
        release: () => {}
    };
    db.connect = async () => client;
    await faregasFormatosService.crearBorradorHtml(6, 'PLANTILLA_FAREGAS');
    assert.match(configuracionInsertada.html, /class="documento-certificado"/);
    assert.match(configuracionInsertada.html, /data-faregas-var="taller\.nombre"/);
    assert.doesNotMatch(configuracionInsertada.html, /Diseño anterior/);
});

test('variable inválida bloquea activación y revierte la transacción', async () => {
    const consultas = [];
    const client = {
        query: async (sql) => {
            consultas.push(String(sql));
            if (String(sql).includes('SELECT activo')) return { rowCount: 1, rows: [{ activo: true }] };
            if (String(sql).includes('SELECT estado, motor')) {
                return { rowCount: 1, rows: [{ estado: 'BORRADOR', motor: 'HTML_DINAMICO', configuracion: { html: '<b data-faregas-var="desconocida.valor"></b>' } }] };
            }
            return { rowCount: 1, rows: [] };
        },
        release: () => {}
    };
    db.connect = async () => client;
    await assert.rejects(() => faregasFormatosService.activarVersion(6, 14), /desconocida\.valor/);
    assert(consultas.some((sql) => sql.includes('ROLLBACK')));
    assert(!consultas.some((sql) => sql.includes("SET estado = 'RETIRADA'")));
});

test('preview y render eligen HTML por motor de la versión', async () => {
    db.query = async () => ({
        rowCount: 1,
        rows: [{ motor: 'HTML_DINAMICO', estado: 'VIGENTE', archivo_ruta: 'ruta-docx-que-no-debe-usarse', configuracion: { html: '<p data-faregas-var="taller.nombre"></p>' } }]
    });
    const preview = await faregasFormatosService.generarPreview(6, 14);
    assert.equal(preview.tipo, 'HTML_DINAMICO');
    assert.match(preview.data, /TALLER DEMO S\.A\.C\./);
    const render = await faregasFormatosService.renderVersion(14, { taller: { nombre: 'Taller Real' } });
    assert.equal(render.tipo, 'HTML_DINAMICO');
    assert.match(render.data, /Taller Real/);
});

test('una versión DOCX histórica sigue la rama DOCX aunque el formato actual sea HTML', async () => {
    db.query = async () => ({
        rowCount: 1,
        rows: [{ motor: 'DOCX_DINAMICO', estado: 'VIGENTE', archivo_ruta: 'NO_EXISTE_TEST', configuracion: {} }]
    });
    await assert.rejects(() => faregasFormatosService.generarPreview(6, 1), /docx de la versión/);
});

test('consulta de versión vigente no usa el estado ACTIVO', () => {
    const fuente = fs.readFileSync(path.join(__dirname, '../services/faregas-certificados.service.js'), 'utf8');
    const consultasVersion = fuente.match(/SELECT id FROM fg_certificado_formato_version[^;]+/g) || [];
    assert(consultasVersion.some((sql) => sql.includes("'VIGENTE'")));
    assert(!consultasVersion.some((sql) => sql.includes("'ACTIVO'")));
});

test('rutas mutables usan PUT y exigen el permiso administrativo existente', () => {
    const fuente = fs.readFileSync(path.join(__dirname, '../routes/faregas-formatos.routes.js'), 'utf8');
    assert.match(fuente, /router\.put\('\/:id\/estado'/);
    assert.match(fuente, /router\.put\('\/:id\/versiones\/:versionId\/activar'/);
    assert.match(fuente, /router\.put\('\/:id\/versiones\/:versionId\/desactivar'/);
    assert.match(fuente, /router\.post\('\/:id\/versiones\/html'/);
    assert.match(fuente, /router\.post\('\/:id\/versiones\/html\/importar-docx'/);
    assert.doesNotMatch(fuente, /router\.post\('\/:id\/versiones\/:versionId\/activar'/);
    assert.match(fuente, /CONFIGURACION_SERVICIOS/);
    assert.match(fuente, /requireAdministrarFormatos/);
});

test('CRUD de operación guarda y devuelve formato_id real', async () => {
    const consultas = [];
    const client = {
        query: async (sql, params = []) => {
            consultas.push({ sql: String(sql), params });
            if (String(sql).includes('SELECT codigo FROM fg_servicio')) return { rowCount: 0, rows: [] };
            if (String(sql).includes('FROM fg_categoria_servicio')) return { rowCount: 1, rows: [{ id: 9, codigo: 'TALLER', nombre: 'Taller' }] };
            if (String(sql).includes('FROM fg_certificado_formato')) return { rowCount: 1, rows: [{ id: 6 }] };
            if (String(sql).includes('INSERT INTO fg_servicio')) return { rowCount: 1, rows: [{ id: 60, formato_id: 6 }] };
            return { rowCount: 1, rows: [] };
        },
        release: () => {}
    };
    db.connect = async () => client;
    const creado = await configService.crearServicio({
        codigo: 'TALLER_TEST', nombre: 'Taller test', categoria_id: 9,
        tipo_flujo: 'TALLER_INSPECCION', requiere_certificado: true,
        tipo_certificado_clave: 'TALLER_INSPECCION', modalidad: null,
        formato_id: 6, requiere_vehiculo: true, orden: 10
    }, 'SISTEMAS', '127.0.0.1');
    assert.deepEqual(creado, { id: 60, formato_id: 6 });
    const insert = consultas.find((consulta) => consulta.sql.includes('INSERT INTO fg_servicio'));
    assert(insert.sql.includes('formato_id'));
    assert.equal(insert.params[8], 6);

    db.query = async (sql) => {
        assert.match(String(sql), /s\.formato_id/);
        assert.match(String(sql), /formato_nombre/);
        return { rows: [{ id: 60, formato_id: 6, formato_nombre: 'Taller' }] };
    };
    const listados = await configService.getServicios();
    assert.equal(listados[0].formato_id, 6);
    assert.equal(listados[0].formato_nombre, 'Taller');

    const consultasEdicion = [];
    const clientEdicion = {
        query: async (sql, params = []) => {
            consultasEdicion.push({ sql: String(sql), params });
            if (String(sql).includes('SELECT * FROM fg_servicio')) {
                return { rowCount: 1, rows: [{ id: 60, codigo: 'TALLER_TEST', formato_id: 6 }] };
            }
            if (String(sql).includes('FROM fg_categoria_servicio')) return { rowCount: 1, rows: [{ id: 9, codigo: 'TALLER', nombre: 'Taller' }] };
            if (String(sql).includes('FROM fg_certificado_formato')) return { rowCount: 1, rows: [{ id: 7 }] };
            return { rowCount: 1, rows: [] };
        },
        release: () => {}
    };
    db.connect = async () => clientEdicion;
    const actualizado = await configService.editarServicio(60, {
        nombre: 'Taller actualizado', categoria_id: 9,
        tipo_flujo: 'TALLER_INSPECCION', requiere_certificado: true,
        tipo_certificado_clave: 'TALLER_INSPECCION', modalidad: null,
        formato_id: 7, requiere_vehiculo: true, orden: 20
    }, 'SISTEMAS', '127.0.0.1');
    const update = consultasEdicion.find((consulta) => consulta.sql.includes('UPDATE fg_servicio SET'));
    assert(update.sql.includes('formato_id = $8'));
    assert.equal(update.params[7], 7);
    assert.equal(actualizado.formato_id, 7);
});
