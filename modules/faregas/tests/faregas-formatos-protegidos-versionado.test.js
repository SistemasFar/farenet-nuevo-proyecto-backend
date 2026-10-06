const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.NODE_ENV = 'test';

const db = require('../../../config/database');
const { faregasFormatosService } = require('../services/faregas-formatos.service');

const withClient = async (query, callback) => {
  const originalConnect = db.connect;
  const client = { query, release() {} };
  db.connect = async () => client;
  try {
    return await callback();
  } finally {
    db.connect = originalConnect;
  }
};

test('protegido con VIGENTE crea BORRADOR nuevo copiando su configuración sin alterar la vigente', async () => {
  const vigente = { html: '<p>{{certificado.numero}}</p>', variables_usadas: ['certificado.numero'] };
  const consultas = [];
  const resultado = await withClient(async (sql, params = []) => {
    consultas.push({ sql: String(sql), params });
    if (sql === 'BEGIN' || sql === 'COMMIT') return { rowCount: 0, rows: [] };
    if (String(sql).includes('FROM fg_certificado_formato\n')) {
      return { rowCount: 1, rows: [{ id: 5, motor: 'SISTEMA', es_protegido: true, activo: true }] };
    }
    if (String(sql).includes("estado = 'BORRADOR'")) return { rowCount: 0, rows: [] };
    if (String(sql).includes("estado = 'VIGENTE'")) return { rowCount: 1, rows: [{ configuracion: vigente }] };
    if (String(sql).includes('COALESCE(MAX(version)')) return { rowCount: 1, rows: [{ siguiente: 4 }] };
    if (String(sql).includes('INSERT INTO fg_certificado_formato_version')) {
      assert.deepEqual(params, [5, 4, vigente]);
      return { rowCount: 1, rows: [{ id: 44, version: 4, estado: 'BORRADOR', motor: 'HTML_DINAMICO', configuracion: params[2] }] };
    }
    throw new Error(`Consulta inesperada: ${sql}`);
  }, () => faregasFormatosService.crearBorradorOficialProtegido(5));

  assert.equal(resultado.reutilizada, false);
  assert.equal(resultado.origen, 'VERSION_VIGENTE');
  assert.equal(resultado.version.estado, 'BORRADOR');
  assert.equal(consultas.some(({ sql }) => /UPDATE[\s\S]+VIGENTE/.test(sql)), false);
});

test('si ya existe BORRADOR lo reutiliza y no inserta un duplicado', async () => {
  let inserciones = 0;
  const borrador = { id: 45, version: 5, estado: 'BORRADOR', motor: 'HTML_DINAMICO', configuracion: { html: '<p>borrador</p>' } };
  const resultado = await withClient(async (sql) => {
    if (sql === 'BEGIN' || sql === 'COMMIT') return { rowCount: 0, rows: [] };
    if (String(sql).includes('FROM fg_certificado_formato\n')) {
      return { rowCount: 1, rows: [{ id: 5, motor: 'SISTEMA', es_protegido: true, activo: true }] };
    }
    if (String(sql).includes("estado = 'BORRADOR'")) return { rowCount: 1, rows: [borrador] };
    if (String(sql).includes('INSERT INTO')) inserciones += 1;
    throw new Error(`Consulta inesperada: ${sql}`);
  }, () => faregasFormatosService.crearBorradorOficialProtegido(5));

  assert.equal(resultado.reutilizada, true);
  assert.equal(resultado.origen, 'BORRADOR_EXISTENTE');
  assert.equal(resultado.version.id, 45);
  assert.equal(inserciones, 0);
});

test('sin VIGENTE crea la primera versión BORRADOR con la plantilla HTML existente', async () => {
  let configuracionInsertada;
  const resultado = await withClient(async (sql, params = []) => {
    if (sql === 'BEGIN' || sql === 'COMMIT') return { rowCount: 0, rows: [] };
    if (String(sql).includes('FROM fg_certificado_formato\n')) {
      return { rowCount: 1, rows: [{ id: 1, motor: 'SISTEMA', es_protegido: true, activo: true }] };
    }
    if (String(sql).includes("estado = 'BORRADOR'")) return { rowCount: 0, rows: [] };
    if (String(sql).includes("estado = 'VIGENTE'")) return { rowCount: 0, rows: [] };
    if (String(sql).includes('COALESCE(MAX(version)')) return { rowCount: 1, rows: [{ siguiente: 1 }] };
    if (String(sql).includes('INSERT INTO fg_certificado_formato_version')) {
      configuracionInsertada = params[2];
      return { rowCount: 1, rows: [{ id: 1, version: 1, estado: 'BORRADOR', motor: 'HTML_DINAMICO', configuracion: params[2] }] };
    }
    throw new Error(`Consulta inesperada: ${sql}`);
  }, () => faregasFormatosService.crearBorradorOficialProtegido(1));

  assert.equal(resultado.origen, 'PLANTILLA_FAREGAS');
  assert.equal(resultado.version.estado, 'BORRADOR');
  assert.match(configuracionInsertada.html, /<!DOCTYPE html>/i);
});

test('CONFORMIDAD sin VIGENTE crea el BORRADOR desde la fuente oficial y no desde la plantilla genérica', async () => {
  let configuracionInsertada;
  const resultado = await withClient(async (sql, params = []) => {
    if (sql === 'BEGIN' || sql === 'COMMIT') return { rowCount: 0, rows: [] };
    if (String(sql).includes('FROM fg_certificado_formato\n')) {
      return {
        rowCount: 1,
        rows: [{ id: 5, codigo: 'CONFORMIDAD', motor: 'SISTEMA', es_protegido: true, activo: true }]
      };
    }
    if (String(sql).includes("estado = 'BORRADOR'")) return { rowCount: 0, rows: [] };
    if (String(sql).includes("estado = 'VIGENTE'")) return { rowCount: 0, rows: [] };
    if (String(sql).includes('COALESCE(MAX(version)')) return { rowCount: 1, rows: [{ siguiente: 1 }] };
    if (String(sql).includes('INSERT INTO fg_certificado_formato_version')) {
      configuracionInsertada = params[2];
      return {
        rowCount: 1,
        rows: [{ id: 113, version: 1, estado: 'BORRADOR', motor: 'HTML_DINAMICO', configuracion: params[2] }]
      };
    }
    throw new Error(`Consulta inesperada: ${sql}`);
  }, () => faregasFormatosService.crearBorradorOficialProtegido(5));

  assert.equal(resultado.origen, 'FUENTE_OFICIAL_PROTEGIDA');
  assert.equal(resultado.version.estado, 'BORRADOR');
  assert.match(configuracionInsertada.html, /CERTIFICADO DE CONFORMIDAD/);
  assert.match(configuracionInsertada.html, /MODIFICACION/);
  assert.match(configuracionInsertada.html, /FABRICACION/);
  assert.doesNotMatch(configuracionInsertada.html, /Nombre del Taller/i);
  assert.ok(configuracionInsertada.variables_usadas.includes('vehiculo.vin'));
  assert.ok(configuracionInsertada.variables_usadas.includes('conformidad.marca_modificacion'));
});

test('activar el BORRADOR reutiliza el flujo existente: retira la vigente y publica la nueva', async () => {
  const consultas = [];
  await withClient(async (sql) => {
    consultas.push(String(sql));
    if (sql === 'BEGIN' || sql === 'COMMIT') return { rowCount: 0, rows: [] };
    if (String(sql).includes('SELECT activo FROM fg_certificado_formato')) return { rowCount: 1, rows: [{ activo: true }] };
    if (String(sql).includes('SELECT estado, motor, configuracion')) {
      return { rowCount: 1, rows: [{ estado: 'BORRADOR', motor: 'HTML_DINAMICO', configuracion: { html: '<p>contenido</p>' } }] };
    }
    if (String(sql).includes('UPDATE fg_certificado_formato_version')) return { rowCount: 1, rows: [] };
    throw new Error(`Consulta inesperada: ${sql}`);
  }, () => faregasFormatosService.activarVersion(5, 44));

  assert.equal(consultas.some((sql) => sql.includes("SET estado = 'RETIRADA'")), true);
  assert.equal(consultas.some((sql) => sql.includes("SET estado = 'VIGENTE'")), true);
});

test('contratos: permiso backend, histórico, futura vigente y variante permanecen separados', () => {
  const raiz = path.join(__dirname, '..');
  const rutas = fs.readFileSync(path.join(raiz, 'routes', 'faregas-formatos.routes.js'), 'utf8');
  const certificados = fs.readFileSync(path.join(raiz, 'services', 'faregas-certificados.service.js'), 'utf8');
  const config = fs.readFileSync(path.join(raiz, 'services', 'faregas-config.service.js'), 'utf8');

  assert.match(rutas, /versiones\/protegido', verificarToken, requireAdministrarFormatos/);
  assert.match(rutas, /MENU_CONFIGURACION[\s\S]+CONFIGURACION_SERVICIOS/);
  assert.match(certificados, /formatoVersionAsignadaId: cert\.formato_version_id/);
  assert.match(certificados, /formato_version_id = \$4/);
  assert.match(certificados, /version\.estado = 'VIGENTE'/);
  assert.match(certificados, /borrador\.estado !== 'EMITIDO' \|\| Boolean\(borrador\.formatoVersionAsignadaId\)/);
  assert.match(certificados, /\(!esFormularioDinamico \|\| cert\.formato_es_protegido\)[\s\S]+cert\.tipo_clave === 'CONFORMIDAD'/);
  assert.match(config, /INSERT INTO fg_certificado_formato[\s\S]+formato_padre_id/);
  assert.match(config, /UPDATE fg_servicio SET formato_id = \$1 WHERE id = \$2/);
});
