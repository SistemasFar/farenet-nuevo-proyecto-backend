const test = require('node:test');
const assert = require('node:assert/strict');
const cheerio = require('cheerio');

const generateConformidadHtml = require('../templates/conformidad.template');
const { formatDateLong } = require('../templates/template-utils');
const {
  extraerVariablesHtml,
  renderizarHtml,
  variablesDesconocidas
} = require('../services/faregas-formatos-html');
const { VARIABLES_CATALOG } = require('../services/faregas-formatos.variables');

const textoDocumento = (html) => cheerio.load(html)('body').text().replace(/\s+/g, ' ').trim();

const datosLegacy = {
  cabecera: {
    numero_certificado: 'DG-41-12345',
    fecha_emision: '2026-10-06',
    cliente_nombre: 'TRANSPORTES PRUEBA S.A.C.'
  },
  vehiculo: {
    placa: 'ABC123', clase: 'M1', categoria: 'M1', modelo: 'YARIS', marca: 'TOYOTA',
    serie: 'SERIE123', vin: 'VIN123', motor: 'MOTOR123', color: 'PLATA', carroceria: 'SEDAN',
    combustible: 'GASOLINA', potencia: '80 / 6000', asientos: '5', pasajeros: '4',
    cilindrada: '1497', cilindros: '4', longitud: '4.30', altura: '1.46', ancho: '1.70',
    peso_bruto: '1450', peso_seco: '1010', carga_util: '440', ano_fabricacion: '2025',
    ano_modelo: '2026', formula_rodante: '4x2', ejes: '2', ruedas: '4', version: '1.5 GLI'
  },
  conformidad: {
    tipo_conformidad: 'MODIFICACION',
    marca_modificacion: true,
    marca_montaje: false,
    marca_fabricacion: false,
    caracteristica_registrable: 'Cambio de carrocería',
    uso_original_vehiculo: 'PERSONAS'
  },
  titulares: [{ nombre_razon_social: 'TRANSPORTES PRUEBA S.A.C.', direccion: 'AV. PRUEBA 123' }]
};

const fecha = formatDateLong(datosLegacy.cabecera.fecha_emision);
const datosDinamicos = {
  certificado: { numero: datosLegacy.cabecera.numero_certificado },
  documento: { clase_preview: '', fecha_dia: fecha.dia, fecha_mes: fecha.mes, fecha_anio: fecha.anio },
  titular: { nombre: datosLegacy.titulares[0].nombre_razon_social, direccion: datosLegacy.titulares[0].direccion },
  vehiculo: {
    placa: 'ABC123', clase: 'M1', categoria: 'M1', modelo: 'YARIS', marca: 'TOYOTA',
    serie_chasis: 'SERIE123', vin: 'VIN123', motor: 'MOTOR123', color: 'PLATA', carroceria: 'SEDAN',
    combustible: 'GASOLINA', potencia: '80 / 6000', asientos: '5', pasajeros: '4',
    cilindrada: '1497', cilindros: '4', longitud: '4.30', altura: '1.46', ancho: '1.70',
    peso_bruto: '1450', peso_neto: '1010', carga_util: '440', anio_fabricacion: '2025',
    anio_modelo: '2026', formula_rodante: '4x2', ejes: '2', ruedas: '4', version: '1.5 GLI'
  },
  conformidad: {
    clase_modificacion: 'active', clase_montaje: '', clase_fabricacion: '',
    marca_modificacion: 'X', marca_montaje: '', marca_fabricacion: '',
    caracteristica_registrable: 'CAMBIO DE CARROCERÍA', uso_original_vehiculo: 'PERSONAS'
  }
};

test('la plantilla editable se genera desde el mismo renderer oficial y sólo usa variables registradas', () => {
  const plantilla = generateConformidadHtml.crearPlantillaConformidadHtml();
  const variables = extraerVariablesHtml(plantilla);

  assert.match(plantilla, /CERTIFICADO DE CONFORMIDAD/);
  assert.match(plantilla, /\.documento-certificado p \{ margin: 0; \}/);
  assert.doesNotMatch(plantilla, /Nombre del Taller/i);
  assert.equal(variables.length, 43);
  assert.deepEqual(variablesDesconocidas(plantilla, VARIABLES_CATALOG.map((item) => item.key)), []);
});

test('legacy y HTML_DINAMICO conservan estructura, contenido legal y datos con la misma entrada', () => {
  const legacy = generateConformidadHtml(datosLegacy, { modo: 'PREVIEW' });
  const dinamico = renderizarHtml(generateConformidadHtml.crearPlantillaConformidadHtml(), datosDinamicos);
  const $legacy = cheerio.load(legacy);
  const $dinamico = cheerio.load(dinamico);

  assert.equal(textoDocumento(dinamico), textoDocumento(legacy));
  assert.equal($dinamico('table').length, $legacy('table').length);
  assert.equal($dinamico('table.data-table tr').length, $legacy('table.data-table tr').length);
  assert.equal($dinamico('.legal-p').length, $legacy('.legal-p').length);
  assert.equal($dinamico('td.active').text().trim(), 'MODIFICACION');
});

test('la visibilidad del sello de borrador es un valor calculado y no un condicional duplicado', () => {
  const final = renderizarHtml(generateConformidadHtml.crearPlantillaConformidadHtml(), {
    ...datosDinamicos,
    documento: { ...datosDinamicos.documento, clase_preview: 'preview-hidden' }
  });
  const $ = cheerio.load(final);

  assert.equal($('.watermark').hasClass('preview-hidden'), true);
  assert.equal($('.preview-badge').hasClass('preview-hidden'), true);
});
