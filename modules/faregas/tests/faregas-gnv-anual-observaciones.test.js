const test = require('node:test');
const assert = require('node:assert/strict');
const cheerio = require('cheerio');
const generateGnvAnualHtml = require('../templates/gnv-anual.template');
const generateGnvInicialHtml = require('../templates/gnv-inicial.template');
const generateGlpAnualHtml = require('../templates/glp-anual.template');
const generateConformidadHtml = require('../templates/conformidad.template');

const baseDataGnvAnual = {
  cabecera: {
    numero_certificado: 'DG-22-0010895',
    fecha_emision: '2026-01-02',
    placa_nueva: 'CHS268',
    entidad_certificadora_nombre: 'SERVICIOS COMPLEMENTARIOS DE TRANSPORTE TERRESTRE Y GRUAS S.A.C.',
    resolucion_directoral: 'R.D. N° 0296-2024 - MTC/17.03',
    domicilio_fiscal: 'Jr. Alberto Secada N°315 Prov. Const del Callao – Prov. Const del Callao',
    telefono_certificadora: '966702160',
    lugar_emision: 'Lima'
  },
  vehiculo: {
    placa: 'CHS268',
    categoria: 'M1',
    marca: 'CHEVROLET',
    modelo: 'SPIN',
    version: '1.8 PRIME AT',
    ano_fabricacion: '2024',
    vin: '9BGJP7560RB123257',
    motor: 'MS3001433',
    cilindros: '04',
    cilindrada: '1796',
    combustible: 'BI-COMBUSTIBLE GNV',
    ejes: '02',
    ruedas: '04',
    asientos: '07',
    pasajeros: '06',
    longitud: '4.416',
    ancho: '1.953',
    altura: '1.662',
    color: 'GRIS TIBURON',
    peso_neto: '1319',
    peso_bruto: '1792'
  },
  gnv: {
    taller_planta_key: '160',
    taller_razon_social: 'CHARING S.A.C. SEDE SURQUILLO',
    vigencia_hasta: '2027-01-02'
  },
  verificaciones: [
    { codigo: 'a', descripcion: 'El equipo completo instalado...', cumple: true },
    { codigo: 'b', descripcion: 'El cilindro y el Kit...', cumple: true },
    { codigo: 'c', descripcion: 'Cada uno de los componentes...', cumple: true },
    { codigo: 'd', descripcion: 'No existan fugas...', cumple: true },
    { codigo: 'e', descripcion: 'Los elementos de cierre...', cumple: true },
    { codigo: 'f', descripcion: 'El sistema de combustión...', cumple: true },
    { codigo: 'g', descripcion: 'Los controles ubicados...', cumple: true },
    { codigo: 'h', descripcion: 'Las exigencias sobre ventilación...', cumple: true }
  ]
};

test('1, 2, 3, 4, 13, 14: Observaciones vacías, ausentes, null, con espacios y marcadores muestran dos líneas punteadas sin basura', () => {
  const casosVacios = [
    { label: 'cadena vacía', val: '' },
    { label: 'ausente', val: undefined },
    { label: 'null', val: null },
    { label: 'espacios', val: '    ' },
    { label: 'literal null', val: 'null' },
    { label: 'literal undefined', val: 'undefined' },
    { label: 'literal N/A', val: 'N/A' },
    { label: 'literal Sin observaciones', val: 'Sin observaciones' },
    { label: 'literal NINGUNA', val: 'NINGUNA' }
  ];

  for (const caso of casosVacios) {
    const data = {
      ...baseDataGnvAnual,
      cabecera: { ...baseDataGnvAnual.cabecera, observaciones: caso.val },
      gnv: { ...baseDataGnvAnual.gnv, observaciones: caso.val }
    };

    const htmlPreview = generateGnvAnualHtml(data, { modo: 'PREVIEW' });
    const htmlFinal = generateGnvAnualHtml(data, { modo: 'FINAL' });

    for (const [modo, html] of [['PREVIEW', htmlPreview], ['FINAL', htmlFinal]]) {
      const $ = cheerio.load(html);
      const obsSec = $('.obs-sec');
      const text = obsSec.text().trim();

      // Debe mostrar el título OBSERVACIONES
      assert.match(text, /OBSERVACIONES:/, `Modo ${modo} (${caso.label}): debe mostrar OBSERVACIONES:`);

      // No debe contener valores no deseados
      assert.doesNotMatch(text, /\bnull\b/i, `Modo ${modo} (${caso.label}): no debe contener null`);
      assert.doesNotMatch(text, /\bundefined\b/i, `Modo ${modo} (${caso.label}): no debe contener undefined`);
      assert.doesNotMatch(text, /\bN\/A\b/i, `Modo ${modo} (${caso.label}): no debe contener N/A`);
      assert.doesNotMatch(text, /\bSin observaciones\b/i, `Modo ${modo} (${caso.label}): no debe contener Sin observaciones`);
      assert.doesNotMatch(text, /\bNINGUNA\b/i, `Modo ${modo} (${caso.label}): no debe contener NINGUNA`);

      // Debe contener las dos líneas punteadas SVG
      assert.equal(obsSec.find('.obs-header-line').length, 1, `Modo ${modo} (${caso.label}): debe tener .obs-header-line`);
      assert.equal(obsSec.find('.obs-dots-full').length, 1, `Modo ${modo} (${caso.label}): debe tener .obs-dots-full`);
      assert.equal(obsSec.find('svg line[stroke-dasharray]').length, 2, `Modo ${modo} (${caso.label}): debe contener 2 líneas punteadas SVG`);
    }
  }
});

test('5. Observaciones con texto: muestra el texto ingresado sin líneas punteadas', () => {
  const observacion = 'Se verificó el correcto funcionamiento del sistema GNV.';
  const data = {
    ...baseDataGnvAnual,
    cabecera: { ...baseDataGnvAnual.cabecera, observaciones: observacion },
    gnv: { ...baseDataGnvAnual.gnv, observaciones: observacion }
  };

  const html = generateGnvAnualHtml(data, { modo: 'FINAL' });
  const $ = cheerio.load(html);
  const obsSec = $('.obs-sec');

  assert.match(obsSec.text(), /OBSERVACIONES:\s*Se verificó el correcto funcionamiento del sistema GNV\./);
  assert.equal(obsSec.find('.obs-dots-full').length, 0, 'No debe tener líneas punteadas cuando hay texto');
  assert.equal(obsSec.find('svg').length, 0, 'No debe tener SVG cuando hay texto');
});

test('6. Observaciones de varias líneas: respeta saltos de línea con <br> sin superponerse', () => {
  const multiline = 'Línea uno de prueba.\nLínea dos de inspección.\nLínea tres conforme.';
  const data = {
    ...baseDataGnvAnual,
    gnv: { ...baseDataGnvAnual.gnv, observaciones: multiline }
  };

  const html = generateGnvAnualHtml(data, { modo: 'FINAL' });
  const $ = cheerio.load(html);
  const obsHtml = $('.obs-sec').html();

  assert.match(obsHtml, /Línea uno de prueba\.<br>Línea dos de inspección\.<br>Línea tres conforme\./);
});

test('7. Texto próximo al límite permitido (250 caracteres): recorta limpiamente y no rompe el HTML', () => {
  const texto260 = 'Z'.repeat(260);
  const data = {
    ...baseDataGnvAnual,
    gnv: { ...baseDataGnvAnual.gnv, observaciones: texto260 }
  };

  const html = generateGnvAnualHtml(data, { modo: 'FINAL' });
  const $ = cheerio.load(html);
  const obsText = $('.obs-sec').text();

  const match = obsText.match(/Z+/);
  assert.ok(match, 'Debe contener la cadena repetida');
  assert.equal(match[0].length, 250, 'Debe truncarse exactamente a 250 caracteres');
});

test('11, 12: Previsualización y PDF final representan exactamente la misma estructura de observaciones', () => {
  const dataVacio = {
    ...baseDataGnvAnual,
    gnv: { ...baseDataGnvAnual.gnv, observaciones: null }
  };
  const htmlPreview = generateGnvAnualHtml(dataVacio, { modo: 'PREVIEW' });
  const htmlFinal = generateGnvAnualHtml(dataVacio, { modo: 'FINAL' });

  const $preview = cheerio.load(htmlPreview);
  const $final = cheerio.load(htmlFinal);

  assert.equal($preview('.obs-sec').html().trim(), $final('.obs-sec').html().trim(), 'El bloque de observaciones debe ser idéntico en preview y final');
});

test('15. Regresión: formatos GLP y Conformidad no son alterados', () => {
  const dataGlp = {
    cabecera: { numero_certificado: 'GLP-001', fecha_emision: '2026-01-02' },
    vehiculo: { placa: 'ABC123', categoria: 'M1', combustible: 'GASOLINA' },
    glp: { vigencia_hasta: '2027-01-02' },
    titulares: [{ nombreRazonSocial: 'EMPRESA PRUEBA', nroDocumento: '20123456789' }]
  };
  const htmlGlp = generateGlpAnualHtml(dataGlp);
  assert.match(htmlGlp, /GLP/, 'Template GLP sigue funcionando');

  const dataConf = {
    cabecera: { numero_certificado: 'CONF-001', fecha_emision: '2026-01-02' },
    vehiculo: { placa: 'ABC123', categoria: 'M1' },
    conformidad: { tipo_conformidad: 'MODIFICACION' }
  };
  const htmlConf = generateConformidadHtml(dataConf);
  assert.match(htmlConf, /CONFORMIDAD/, 'Template Conformidad sigue funcionando');
});

test('8, 9, 10: Guardado y persistencia en backend admite observaciones ausentes, null, vacías y con texto', async () => {
  const db = require('../../../config/database');
  const authService = require('../services/faregas-auth.service');
  const certificados = require('../services/faregas-certificados.service');

  const originalConnect = db.connect;
  const originalAcceso = authService.validarAccesoPlanta;
  let paramsGuardadosGnv = null;
  let paramsUpdateCert = null;

  db.connect = async () => ({
    async query(sql, params = []) {
      const texto = String(sql);
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(texto)) return { rowCount: 0, rows: [] };
      if (texto.includes('SELECT estado, planta_key, tipo_certificado_clave')) {
        return { rowCount: 1, rows: [{ estado: 'BORRADOR', planta_key: '160', tipo_certificado_clave: 'GNV_ANUAL' }] };
      }
      if (texto.includes('FROM fg_taller_autorizado ta')) {
        return { rowCount: 1, rows: [{ id: 160, planta_key: '160', sede: 'SURQUILLO', razon_social: 'CHARING S.A.C.', direccion: null, codigo_autorizacion: null }] };
      }
      if (texto.includes('SELECT modalidad FROM fg_certificado_gnv')) {
        return { rowCount: 0, rows: [] };
      }
      if (texto.includes('INSERT INTO fg_certificado_gnv')) {
        paramsGuardadosGnv = params;
        return { rowCount: 1, rows: [] };
      }
      if (texto.includes('UPDATE fg_certificado SET observaciones')) {
        paramsUpdateCert = params;
        return { rowCount: 1, rows: [] };
      }
      throw new Error(`Consulta inesperada: ${texto}`);
    },
    release() {}
  });
  authService.validarAccesoPlanta = async () => true;

  try {
    // Caso 1: data.observaciones vacía
    await certificados.guardarGNV(801, {
      vigenciaHasta: '2027-10-06',
      modalidad: 'ANUAL',
      observaciones: ''
    }, { username: 'test', perfil_id: 1 });
    assert.equal(paramsGuardadosGnv[12], null, 'Cadena vacía debe normalizarse a null');
    assert.equal(paramsGuardadosGnv[13], true, 'Debe marcarse como enviada explícitamente');
    assert.equal(paramsUpdateCert[0], null, 'fg_certificado debe sincronizarse a null');

    // Caso 2: data.observaciones ausente
    paramsGuardadosGnv = null;
    paramsUpdateCert = null;
    await certificados.guardarGNV(801, {
      vigenciaHasta: '2027-10-06',
      modalidad: 'ANUAL'
    }, { username: 'test', perfil_id: 1 });
    assert.equal(paramsGuardadosGnv[12], null);
    assert.equal(paramsGuardadosGnv[13], false, 'Observaciones ausentes no deben sobreescribir');
    assert.equal(paramsUpdateCert, null, 'fg_certificado no debe actualizarse si es ausente');

    // Caso 3: data.observaciones con texto
    paramsGuardadosGnv = null;
    paramsUpdateCert = null;
    await certificados.guardarGNV(801, {
      vigenciaHasta: '2027-10-06',
      modalidad: 'ANUAL',
      observaciones: 'Se verificó el correcto funcionamiento del sistema GNV.'
    }, { username: 'test', perfil_id: 1 });
    assert.equal(paramsGuardadosGnv[12], 'Se verificó el correcto funcionamiento del sistema GNV.');
    assert.equal(paramsGuardadosGnv[13], true);
    assert.equal(paramsUpdateCert[0], 'Se verificó el correcto funcionamiento del sistema GNV.');
  } finally {
    db.connect = originalConnect;
    authService.validarAccesoPlanta = originalAcceso;
  }
});

test.after(() => {
  setTimeout(() => process.exit(0), 50);
});

