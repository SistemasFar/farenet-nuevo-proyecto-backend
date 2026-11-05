const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.NODE_ENV = 'test';

const db = require('../../../config/database');
const generateGlpInicialHtml = require('../templates/glp-inicial.template');
const visual = require('../services/faregas-formatos-sistema-visual.service');

test('el diseñador usa el HTML real GLP_INICIAL y aplica sólo propiedades controladas', () => {
  const base = generateGlpInicialHtml(visual.datosDemoGlpInicial(), { modo: 'PREVIEW' });
  assert.match(base, /CERTIFICADO DE CONFORMIDAD DE CONVERSION GLP/);
  assert.match(base, /data-sistema-edicion="titulo"/);
  assert.match(base, /Placa de Rodaje/);
  assert.match(base, /Que cuenta con los siguientes componentes/);

  const html = visual.aplicarDisenoAHtml(base, {
    textos: { titulo: 'CERTIFICADO GLP PERSONALIZADO' },
    titulo: { fontSizePx: 19, textAlign: 'center' },
    tablas: { cellPaddingPx: 4 }
  });
  assert.match(html, /CERTIFICADO GLP PERSONALIZADO/);
  assert.match(html, /font-size: 19px !important/);
  assert.match(html, /padding: 4px !important/);
  assert.match(html, /ABC123/);
  assert.match(html, /GLP-CIL-0001/);
});

test('el registro renderiza el generador real de cada familia SISTEMA sin mezclar formatos', () => {
  const esperados = {
    GLP_INICIAL: /CERTIFICADO DE CONFORMIDAD DE CONVERSION GLP/,
    GLP_ANUAL: /CERTIFICADO DE INSPECCION DEL VEHICULO A GLP/,
    GNV_INICIAL: /CERTIFICADO DE CONFORMIDAD DE CONVERSIÓN A GNV/,
    GNV_ANUAL: /CERTIFICADO DE INSPECCION ANUAL DEL VEHICULO A GNV/,
    CONFORMIDAD: /CERTIFICADO DE CONFORMIDAD/
  };
  assert.deepEqual([...visual.CODIGOS_FORMATO_SOPORTADOS].sort(), Object.keys(esperados).sort());
  for (const [codigo, esperado] of Object.entries(esperados)) {
    const registro = visual.obtenerRegistroFormato(codigo);
    const base = registro.generador(registro.datosDemo(), { modo: 'PREVIEW' });
    const personalizado = visual.aplicarDisenoAHtml(base, {
      textos: { titulo: `DISEÑO CONTROLADO ${codigo}` }
    }, codigo);
    assert.match(base, esperado);
    assert.match(base, /data-sistema-edicion="titulo"/);
    assert.match(personalizado, new RegExp(`DISEÑO CONTROLADO ${codigo}`));
  }
});

test('rechaza formatos desconocidos y una configuración visual perteneciente a otro formato', () => {
  assert.equal(visual.obtenerRegistroFormato('DESCONOCIDO'), null);
  assert.throws(() => visual.aplicarDisenoAHtml('<html></html>', {}, 'DESCONOCIDO'), /no posee un generador visual autorizado/);
  const configuracion = {
    tipo: visual.TIPO_CONFIGURACION,
    codigoFormato: 'GLP_INICIAL',
    diseno: visual.normalizarDiseno({})
  };
  assert.equal(visual.debeAplicarDisenoVisual({
    estado: 'BORRADOR',
    versionAsignadaId: null,
    versionResueltaId: 1,
    configuracion,
    codigoFormato: 'GNV_INICIAL'
  }), false);
});

test('rechaza propiedades, HTML y valores fuera de los rangos autorizados', () => {
  assert.throws(() => visual.normalizarDiseno({ css: 'body{display:none}' }), /propiedades no permitidas/);
  assert.throws(() => visual.normalizarDiseno({ textos: { titulo: '<script>alert(1)<\/script>' } }), /no es válido/);
  assert.throws(() => visual.normalizarDiseno({ pagina: { paddingPx: 500 } }), /entre 8 y 60/);
});

test('guardar un borrador persiste la configuración y volver a consultar recupera el mismo diseño', async () => {
  const originalQuery = db.query;
  let configuracionPersistida = {
    tipo: visual.TIPO_CONFIGURACION,
    codigoFormato: 'GLP_INICIAL',
    diseno: visual.normalizarDiseno({})
  };

  db.query = async (sql, params = []) => {
    const texto = String(sql);
    if (texto.includes('FROM fg_certificado_formato\n')) {
      return { rowCount: 1, rows: [{ id: 7, codigo: 'GLP_INICIAL', motor: 'SISTEMA', es_protegido: true, activo: true }] };
    }
    if (texto.includes('UPDATE fg_certificado_formato_version')) {
      configuracionPersistida = JSON.parse(params[0]);
      return {
        rowCount: 1,
        rows: [{ id: 70, version: 3, estado: 'BORRADOR', motor: 'SISTEMA', configuracion: configuracionPersistida, creado_en: '2026-11-04' }]
      };
    }
    if (texto.includes('FROM fg_certificado_formato_version')) {
      return {
        rowCount: 1,
        rows: [{ id: 70, version: 3, estado: 'BORRADOR', motor: 'SISTEMA', configuracion: configuracionPersistida, creado_en: '2026-11-04' }]
      };
    }
    throw new Error(`Consulta no simulada: ${texto}`);
  };

  try {
    const guardada = await visual.guardarBorrador(7, 70, { titulo: { fontSizePx: 21 } });
    assert.equal(guardada.diseno.titulo.fontSizePx, 21);
    const recuperada = await visual.obtenerEstadoDiseno(7);
    assert.equal(recuperada.borrador.id, 70);
    assert.equal(recuperada.borrador.diseno.titulo.fontSizePx, 21);
  } finally {
    db.query = originalQuery;
  }
});

test('activar publica el borrador en una transacción y retira la versión anterior', async () => {
  const originalConnect = db.connect;
  const consultas = [];
  const configuracion = { tipo: visual.TIPO_CONFIGURACION, codigoFormato: 'GLP_INICIAL', diseno: visual.normalizarDiseno({}) };
  const cliente = {
    release() {},
    query: async (sql) => {
      const texto = String(sql);
      consultas.push(texto);
      if (texto === 'BEGIN' || texto === 'COMMIT') return { rowCount: 0, rows: [] };
      if (texto.includes('FROM fg_certificado_formato\n')) {
        return { rowCount: 1, rows: [{ id: 7, codigo: 'GLP_INICIAL', motor: 'SISTEMA', es_protegido: true, activo: true }] };
      }
      if (texto.includes('FROM fg_certificado_formato_version') && texto.includes('FOR UPDATE')) {
        return { rowCount: 1, rows: [{ id: 70, version: 3, estado: 'BORRADOR', motor: 'SISTEMA', configuracion }] };
      }
      if (texto.includes("SET estado = 'RETIRADA'")) return { rowCount: 1, rows: [] };
      if (texto.includes("SET estado = 'VIGENTE'")) {
        return { rowCount: 1, rows: [{ id: 70, version: 3, estado: 'VIGENTE', motor: 'SISTEMA', configuracion, vigente_desde: '2026-11-04' }] };
      }
      throw new Error(`Consulta no simulada: ${texto}`);
    }
  };
  db.connect = async () => cliente;
  try {
    const version = await visual.activarBorrador(7, 70);
    assert.equal(version.estado, 'VIGENTE');
    assert.equal(consultas.includes('BEGIN'), true);
    assert.equal(consultas.some((sql) => sql.includes("SET estado = 'RETIRADA'")), true);
    assert.equal(consultas.some((sql) => sql.includes("SET estado = 'VIGENTE'")), true);
    assert.equal(consultas.includes('COMMIT'), true);
  } finally {
    db.connect = originalConnect;
  }
});

test('la emisión aplica una versión fijada y evita aplicar la vigente actual a históricos sin versión', () => {
  const configuracion = { tipo: visual.TIPO_CONFIGURACION, diseno: visual.normalizarDiseno({}) };
  assert.equal(visual.debeAplicarDisenoVisual({ estado: 'BORRADOR', versionAsignadaId: null, versionResueltaId: 8, configuracion }), true);
  assert.equal(visual.debeAplicarDisenoVisual({ estado: 'EMITIDO', versionAsignadaId: 8, versionResueltaId: 8, configuracion }), true);
  assert.equal(visual.debeAplicarDisenoVisual({ estado: 'EMITIDO', versionAsignadaId: null, versionResueltaId: 8, configuracion }), false);
  assert.equal(visual.debeAplicarDisenoVisual({ estado: 'EMITIDO', versionAsignadaId: 7, versionResueltaId: 8, configuracion }), false);
  const archivo = fs.readFileSync(path.join(__dirname, '..', 'services', 'faregas-certificados.service.js'), 'utf8');
  assert.match(archivo, /formato_version_id = \$4/);
  assert.match(archivo, /version\.id = c\.formato_version_id/);
  assert.match(archivo, /debeAplicarDisenoVisual/);
  assert.match(archivo, /aplicarDisenoAHtml\(html, disenoDesdeConfiguracion\(configuracionVisual, codigoEsperado\), codigoEsperado\)/);
  assert.match(archivo, /__representacion_html_emitida/);
  assert.match(archivo, /borrador\.representacionHtmlEmitida/);
  assert.match(archivo, /Object\.defineProperty\(respuesta, 'representacionHtmlEmitida'/);
});

test('las rutas no exponen lectura ni escritura del archivo JavaScript', () => {
  const rutas = fs.readFileSync(path.join(__dirname, '..', 'routes', 'faregas-formatos.routes.js'), 'utf8');
  assert.doesNotMatch(rutas, /guardarPlantillaSistema/);
  assert.doesNotMatch(rutas, /leerPlantillaSistema/);
  assert.match(rutas, /diseno-sistema\/borrador/);
  assert.match(rutas, /requireAdministrarFormatos/);
  assert.match(rutas, /se versiona exclusivamente mediante el diseñador visual de su certificado real/);
});
