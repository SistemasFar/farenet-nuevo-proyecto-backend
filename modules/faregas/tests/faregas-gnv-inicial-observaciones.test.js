const test = require('node:test');
const assert = require('node:assert/strict');
const cheerio = require('cheerio');
const generateGnvInicialHtml = require('../templates/gnv-inicial.template');

const baseData = {
  cabecera: {
    numero_certificado: 'DG-22-0012468',
    fecha_emision: '2026-10-14'
  },
  vehiculo: {
    placa: 'ABC-123',
    categoria: 'M1',
    marca: 'TOYOTA',
    modelo: 'YARIS',
    version: 'STD',
    anio_fabricacion: '2020',
    vin: 'VIN123456789',
    motor: 'MOT123456789',
    cilindros: '4',
    cilindrada: '1500',
    combustible: 'GASOLINA',
    ejes: '2',
    ruedas: '4',
    asientos: '5',
    pasajeros: '4',
    longitud: '4.3',
    ancho: '1.7',
    altura: '1.5',
    color: 'GRIS',
    peso_neto: '1050',
    peso_bruto: '1450'
  },
  gnv: {
    modalidad: 'INICIAL',
    combustible_posterior: 'BI - COMBUSTIBLE GNV',
    peso_neto_posterior: '1120'
  },
  componentes: [
    { orden: 1, componente: 'Reductor', marca: 'Tomasetto', numero_serie: 'R123', capacidad_litros: 'NO APLICA', mes_fabricacion: '01', anio_fabricacion: '2023' }
  ]
};

test('CASO A — GNV Inicial con observación "SSSS" muestra la observación y conserva texto oficial', () => {
  const data = {
    ...baseData,
    gnv: { ...baseData.gnv, observaciones: 'SSSS' }
  };
  const html = generateGnvInicialHtml(data, { modo: 'PREVIEW' });
  const $ = cheerio.load(html);

  const obsText = $('.obs-sec').text();
  assert.match(obsText, /SSSS/);
  assert.match(obsText, /Numerales del 1 al 16/);
  assert.match(obsText, /NTP 111\.015:2004/);
  assert.match(obsText, /Directiva N° 001-2005-MTC\/15/);
  assert.match(obsText, /D\.S\. 047-2001-MTC/);

  // La observación del operador precede al texto oficial
  const ssssIdx = obsText.indexOf('SSSS');
  const numeralesIdx = obsText.indexOf('Numerales del 1 al 16');
  assert.ok(ssssIdx < numeralesIdx, 'La observación debe aparecer antes de los numerales');
});

test('CASO B — GNV Inicial con observación vacía, null, undefined o marcador no imprime basura', () => {
  const casosVacios = ['', '   ', null, undefined, 'null', 'undefined', '-', 'vacío', 'VACIO'];

  for (const valor of casosVacios) {
    const data = {
      ...baseData,
      gnv: { ...baseData.gnv, observaciones: valor }
    };
    const html = generateGnvInicialHtml(data, { modo: 'PREVIEW' });
    const $ = cheerio.load(html);

    const obsHtml = $('.obs-sec').html();
    const obsText = $('.obs-sec').text();

    assert.doesNotMatch(obsText, /\bnull\b/i);
    assert.doesNotMatch(obsText, /\bundefined\b/i);
    assert.doesNotMatch(obsText, /OBSERVACIÓN DEL OPERADOR/i);
    assert.match(obsText, /Numerales del 1 al 16/);
    assert.match(obsText, /NTP 111\.015:2004/);

    // No debe haber div vacío al inicio de obs-sec
    assert.doesNotMatch(obsHtml, /<div style="margin-bottom: 8px;"><\/div>/);
  }
});

test('CASO C — GNV Inicial con observación "REVISAR SOPORTE POSTERIOR DEL CILINDRO"', () => {
  const observacion = 'REVISAR SOPORTE POSTERIOR DEL CILINDRO';
  const data = {
    ...baseData,
    gnv: { ...baseData.gnv, observaciones: observacion }
  };
  const html = generateGnvInicialHtml(data, { modo: 'PREVIEW' });
  const $ = cheerio.load(html);

  const obsText = $('.obs-sec').text();
  assert.match(obsText, /REVISAR SOPORTE POSTERIOR DEL CILINDRO/);
  assert.match(obsText, /Numerales del 1 al 16/);
});

test('CASO D — Soporta observación pasada en data.cabecera.observaciones para máxima consistencia', () => {
  const data = {
    ...baseData,
    cabecera: { ...baseData.cabecera, observaciones: 'OBSERVACION EN CABECERA' },
    gnv: { ...baseData.gnv, observaciones: null }
  };
  const html = generateGnvInicialHtml(data, { modo: 'PREVIEW' });
  const $ = cheerio.load(html);

  assert.match($('.obs-sec').text(), /OBSERVACION EN CABECERA/);
});

test('CASO E — Modo FINAL (emisión definitiva) conserva la observación', () => {
  const data = {
    ...baseData,
    cabecera: { ...baseData.cabecera, numero_certificado: 'DG-22-0012468' },
    gnv: { ...baseData.gnv, observaciones: 'SSSS' }
  };
  const html = generateGnvInicialHtml(data, { modo: 'FINAL' });
  const $ = cheerio.load(html);

  assert.match($('.obs-sec').text(), /SSSS/);
  assert.match($('.obs-sec').text(), /Numerales del 1 al 16/);
  assert.doesNotMatch(html, /<div class="watermark">/);
});

test('SEGURIDAD Y ESCAPADO — Caracteres HTML peligrosos son escapados y saltos de línea preservados', () => {
  const xssObservacion = '<script>alert("XSS")</script> & <b>negrita</b>\nSEGUNDA LINEA';
  const data = {
    ...baseData,
    gnv: { ...baseData.gnv, observaciones: xssObservacion }
  };
  const html = generateGnvInicialHtml(data, { modo: 'PREVIEW' });

  // No debe contener tags HTML inyectados
  assert.doesNotMatch(html, /<script>/i);
  assert.doesNotMatch(html, /<b>negrita<\/b>/i);
  // Debe contener las entidades escapadas
  assert.match(html, /&lt;script&gt;alert\(&quot;XSS&quot;\)&lt;\/script&gt;/);
  assert.match(html, /&amp;/);
  assert.match(html, /&lt;b&gt;negrita&lt;\/b&gt;/);
  // El salto de línea se convierte en <br>
  assert.match(html, /<br>/);
});

test('LONGITUD MÁXIMA — Se recorta a 250 caracteres', () => {
  const longText = 'A'.repeat(300);
  const data = {
    ...baseData,
    gnv: { ...baseData.gnv, observaciones: longText }
  };
  const html = generateGnvInicialHtml(data, { modo: 'PREVIEW' });
  const $ = cheerio.load(html);

  const matched = $('.obs-sec').text().match(/A+/);
  assert.ok(matched, 'Debe haber letras A');
  assert.equal(matched[0].length, 250);
});
