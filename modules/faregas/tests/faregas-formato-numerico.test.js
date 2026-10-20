const test = require('node:test');
const assert = require('node:assert/strict');
const { formatNumberWithoutTrailingZeros, formatNumeroCertificado } = require('../templates/template-utils');
const generateGlpInicialHtml = require('../templates/glp-inicial.template');
const generateGlpAnualHtml = require('../templates/glp-anual.template');
const generateGnvInicialHtml = require('../templates/gnv-inicial.template');
const generateGnvAnualHtml = require('../templates/gnv-anual.template');
const generateConformidadHtml = require('../templates/conformidad.template');

test('helper formatNumeroCertificado y formatNumberWithoutTrailingZeros eliminan sólo ceros finales y preservan decimales significativos', () => {
  // Enteros con ceros decimales
  assert.equal(formatNumeroCertificado('11110.000'), '11110');
  assert.equal(formatNumeroCertificado('1301.000'), '1301');
  assert.equal(formatNumeroCertificado('1450.000'), '1450');
  assert.equal(formatNumeroCertificado('149.000'), '149');

  // Decimales con ceros finales sobrantes
  assert.equal(formatNumeroCertificado('4.300'), '4.3');
  assert.equal(formatNumeroCertificado('1.690'), '1.69');
  assert.equal(formatNumeroCertificado('1.460'), '1.46');
  assert.equal(formatNumeroCertificado('1.530'), '1.53');
  assert.equal(formatNumeroCertificado('0.500'), '0.5');

  // Decimales significativos sin ceros finales sobrantes
  assert.equal(formatNumeroCertificado('3.845'), '3.845');
  assert.equal(formatNumeroCertificado('1.735'), '1.735');

  // Capacidad de cilindro
  assert.equal(formatNumeroCertificado('111.00'), '111');
  assert.equal(formatNumeroCertificado('111.50'), '111.5');

  // Cadenas no numéricas se preservan
  assert.equal(formatNumeroCertificado('ABC001'), 'ABC001');

  // Vacíos / nulls
  assert.equal(formatNumeroCertificado(null), '');
  assert.equal(formatNumeroCertificado(''), '');
  assert.equal(formatNumeroCertificado(undefined), '');

  // Valores numéricos nativos de JS
  assert.equal(formatNumeroCertificado(4.3), '4.3');
  assert.equal(formatNumeroCertificado(11110), '11110');
});

test('GLP Inicial: template elimina ceros decimales en preview y conserva decimales significativos', () => {
  const data = {
    cabecera: { numero_certificado: 'DG-41-000100', fecha_emision: '2026-10-13', cliente_nombre: 'CLIENTE TEST' },
    vehiculo: {
      placa: 'ABC123',
      categoria: 'M1',
      marca: 'TOYOTA',
      modelo: 'YARIS',
      version: '1.5',
      ano_fabricacion: '2020',
      vin: 'VIN12345678',
      motor: 'MOT999',
      cilindros: '4.000',
      cilindrada: '11110.000',
      combustible: 'GASOLINA',
      ejes: '2.000',
      ruedas: '4.000',
      asientos: '5.000',
      pasajeros: '4.000',
      longitud: '4.300',
      ancho: '1.690',
      altura: '1.460',
      peso_neto: '1301.000',
      peso_bruto: '1450.000',
      carga_util: '149.000',
    },
    glp: {
      vigencia_hasta: '2027-10-13',
      combustible_posterior: 'BI-COMBUSTIBLE GLP',
      peso_neto_posterior: '1330.000',
      carga_util_posterior: '360.000',
    },
    componentes: [
      {
        componente: 'CILINDRO',
        marca: 'CIL-CORP',
        modelo: '',
        capacidad_litros: '111.00',
        anio_fabricacion: '2024',
        numero_serie: 'CIL-99',
      },
      {
        componente: 'REGULADOR',
        marca: 'REG-CORP',
        modelo: 'MOD-R',
        numero_serie: 'REG-88',
      },
    ],
    verificaciones: Array.from({ length: 7 }, (_, i) => ({ codigo: String(i + 1), cumple: true })),
    titulares: [{ nombre_razon_social: 'CLIENTE TEST' }],
  };

  const html = generateGlpInicialHtml(data, { modo: 'PREVIEW' });

  // Valores sin ceros decimales sobrantes
  assert.match(html, /4 \/ 11110/);
  assert.match(html, /4\.3 \/ 1\.69 \/ 1\.46/);
  assert.match(html, /1301/);
  assert.match(html, /1450/);
  assert.match(html, /149/);
  assert.match(html, /1330/);
  assert.match(html, /360/);
  assert.match(html, /111 LTS \/ 2024/);

  // No debe aparecer ningún .000 en las mediciones
  assert.doesNotMatch(html, /11110\.000/);
  assert.doesNotMatch(html, /1301\.000/);
  assert.doesNotMatch(html, /1450\.000/);
  assert.doesNotMatch(html, /149\.000/);
  assert.doesNotMatch(html, /4\.300/);
  assert.doesNotMatch(html, /1\.690/);
  assert.doesNotMatch(html, /1\.460/);
  assert.doesNotMatch(html, /111\.00 LTS/);
});

test('GLP Inicial: capacidad con decimal significativo (111.50) se muestra como 111.5 LTS', () => {
  const data = {
    cabecera: {},
    vehiculo: {},
    glp: {},
    componentes: [
      {
        componente: 'CILINDRO',
        marca: 'CIL-CORP',
        capacidad_litros: '111.50',
        anio_fabricacion: '2024',
        numero_serie: 'CIL-99',
      },
    ],
    verificaciones: [],
    titulares: [],
  };

  const html = generateGlpInicialHtml(data, { modo: 'PREVIEW' });
  assert.match(html, /111\.5 LTS \/ 2024/);
  assert.doesNotMatch(html, /111\.50 LTS/);
});

test('GNV Inicial y Anual: eliminan ceros decimales en mediciones de vehículo y conversión', () => {
  const dataGnv = {
    cabecera: {},
    vehiculo: {
      cilindros: '4.000',
      cilindrada: '1600.000',
      ejes: '2.000',
      ruedas: '4.000',
      asientos: '5.000',
      pasajeros: '4.000',
      longitud: '4.200',
      ancho: '1.700',
      altura: '1.500',
      peso_neto: '1200.000',
      peso_bruto: '1600.000',
    },
    gnv: {
      peso_neto_posterior: '1250.000',
    },
    componentes: [
      { orden: 1, componente: 'CILINDRO', marca: 'CYL', numero_serie: 'C1', capacidad_litros: '80.00', mes_fabricacion: '05', anio_fabricacion: '2023' },
    ],
    verificaciones: [],
    titulares: [],
  };

  const htmlGnvIni = generateGnvInicialHtml(dataGnv, { modo: 'PREVIEW' });
  assert.match(htmlGnvIni, /4 \/ 1600/);
  assert.match(htmlGnvIni, /02 \/ 04/);
  assert.match(htmlGnvIni, /05 \/ 04/);
  assert.match(htmlGnvIni, /4\.2 \/ 1\.7 \/ 1\.5/);
  assert.match(htmlGnvIni, /1200/);
  assert.match(htmlGnvIni, /1600/);
  assert.match(htmlGnvIni, /1250/);
  assert.match(htmlGnvIni, />80</);
  assert.doesNotMatch(htmlGnvIni, /1600\.000/);

  const htmlGnvAnual = generateGnvAnualHtml(dataGnv, { modo: 'PREVIEW' });
  assert.match(htmlGnvAnual, /4 \/ 1600/);
  assert.match(htmlGnvAnual, /02 \/ 04/);
  assert.match(htmlGnvAnual, /05 \/ 04/);
  assert.match(htmlGnvAnual, /4\.2 \/ 1\.7 \/ 1\.5/);
  assert.doesNotMatch(htmlGnvAnual, /1600\.000/);
});

test('Conformidad: elimina ceros decimales en mediciones numéricas', () => {
  const dataConf = {
    cabecera: {},
    vehiculo: {
      longitud: '4.500',
      ancho: '1.800',
      peso_neto: '1350.000',
      peso_bruto: '1800.000',
      carga_util: '450.000',
      cilindrada: '2000.000',
      cilindros: '4.000',
      ejes: '2.000',
      ruedas: '4.000',
      asientos: '5.000',
      pasajeros: '4.000',
      potencia: '110.000',
    },
    conformidad: {},
    titulares: [],
  };

  const html = generateConformidadHtml(dataConf, { modo: 'PREVIEW' });
  assert.match(html, />4\.5</);
  assert.match(html, />1\.8</);
  assert.match(html, />1350</);
  assert.match(html, />1800</);
  assert.match(html, />450</);
  assert.match(html, /2000 \/ 4/);
  assert.match(html, />02</);
  assert.match(html, /05 \/ 04/);
  assert.match(html, />04</);
  assert.doesNotMatch(html, /1350\.000/);
  assert.doesNotMatch(html, /4\.500/);
});
