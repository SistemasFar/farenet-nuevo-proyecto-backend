const test = require('node:test');
const assert = require('node:assert/strict');
const cheerio = require('cheerio');

const generateGlpInicialHtml = require('../templates/glp-inicial.template');
const generateGlpAnualHtml = require('../templates/glp-anual.template');
const generateGnvInicialHtml = require('../templates/gnv-inicial.template');
const generateGnvAnualHtml = require('../templates/gnv-anual.template');
const generateConformidadHtml = require('../templates/conformidad.template');

const { renderizarHtml } = require('../services/faregas-formatos-html');

test('GLP Inicial: template genera HTML con todos los campos en orden y no muestra campos no usados', () => {
  const data = {
    cabecera: { numero_certificado: 'GLP-001', fecha_emision: '2026-10-12', cliente_nombre: 'JUAN PEREZ' },
    vehiculo: {
      placa: 'ABC123', categoria: 'M1', marca: 'TOYOTA', modelo: 'YARIS', version: '1.5',
      ano_fabricacion: '2020', vin: 'VIN12345678', motor: 'MOT999', cilindros: '4', cilindrada: '1500',
      combustible: 'GASOLINA', ejes: '2', ruedas: '4', asientos: '5', pasajeros: '4',
      longitud: '4.20', ancho: '1.70', altura: '1.50', peso_neto: '1100', peso_bruto: '1500', carga_util: '400'
    },
    glp: {
      vigencia_hasta: '2027-10-12', expediente_tecnico: 'EXP-GLP-001',
      combustible_posterior: 'BI-COMBUSTIBLE GLP', peso_neto_posterior: '1150', carga_util_posterior: '350'
    },
    componentes: [
      { componente: 'CILINDRO', marca: 'CYL-CORP', modelo: 'MOD-C', capacidad_litros: '40', mes_fabricacion: '05', anio_fabricacion: '2020', numero_serie: 'SN-CIL-01' },
      { componente: 'REGULADOR', marca: 'REG-CORP', modelo: 'MOD-R', numero_serie: 'SN-REG-01' }
    ],
    verificaciones: [
      { codigo: '1', descripcion: 'Punto 1', cumple: true },
      { codigo: '2', descripcion: 'Punto 2', cumple: true },
      { codigo: '3', descripcion: 'Punto 3', cumple: true },
      { codigo: '4', descripcion: 'Punto 4', cumple: true },
      { codigo: '5', descripcion: 'Punto 5', cumple: true },
      { codigo: '6', descripcion: 'Punto 6', cumple: true },
      { codigo: '7', descripcion: 'Punto 7', cumple: true }
    ],
    titulares: [{ nombre_razon_social: 'JUAN PEREZ' }]
  };

  const html = generateGlpInicialHtml(data, { modo: 'PREVIEW' });
  const $ = cheerio.load(html);

  assert.match(html, /CERTIFICADO DE CONFORMIDAD DE CONVERSION GLP/);
  assert.equal($('table.data-table tr td.num').length >= 17, true);
  assert.match($('table.data-table').first().text(), /JUAN PEREZ/);
  assert.match($('table.data-table').first().text(), /ABC123/);
  assert.match($('table.data-table').first().text(), /GASOLINA/);
  assert.match($('table.data-table').first().text(), /VIN12345678/);

  // Conversion table
  assert.match(html, /BI-COMBUSTIBLE GLP/);
  assert.match(html, /1150/);
  assert.match(html, /350/);

  // Components table
  assert.equal($('table.comp-table tbody tr').length, 2);
  assert.match($('table.comp-table').text(), /CYL-CORP/);
  assert.match($('table.comp-table').text(), /REG-CORP/);
});

test('GLP Anual: template muestra el combustible seleccionado y expediente técnico de certificado', () => {
  const data = {
    cabecera: { numero_certificado: 'GLP-ANUAL-002', fecha_emision: '2026-10-12', cliente_nombre: 'MARIA LOPEZ' },
    vehiculo: {
      placa: 'XYZ789', categoria: 'M1', marca: 'NISSAN', modelo: 'SENTRA', version: 'ADVANCE',
      ano_fabricacion: '2019', serie: 'SER123456', motor: 'MOT888', cilindros: '4.000', cilindrada: '1600.000',
      combustible: 'GLP',
      ejes: '2', ruedas: '4', asientos: '5', pasajeros: '4',
      longitud: '4.300', ancho: '1.750', altura: '1.500', peso_neto: '1301.000', peso_bruto: '1450.000', carga_util: '149.000'
    },
    glp: { vigencia_hasta: '2027-10-12' },
    componentes: [
      { componente: 'CILINDRO', marca: 'CYL', modelo: 'MOD', capacidad_litros: '45', mes_fabricacion: '01', anio_fabricacion: '2019', numero_serie: 'C123' },
      { componente: 'REGULADOR', marca: 'REG', modelo: 'MOD', numero_serie: 'R123' }
    ],
    verificaciones: [
      { codigo: '1', descripcion: 'Punto 1', cumple: true },
      { codigo: '2', descripcion: 'Punto 2', cumple: true },
      { codigo: '3', descripcion: 'Punto 3', cumple: true },
      { codigo: '4', descripcion: 'Punto 4', cumple: true },
      { codigo: '5', descripcion: 'Punto 5', cumple: true },
      { codigo: '6', descripcion: 'Punto 6', cumple: true },
      { codigo: '7', descripcion: 'Punto 7', cumple: true }
    ],
    titulares: [{ nombre_razon_social: 'MARIA LOPEZ' }]
  };

  const html = generateGlpAnualHtml(data, { modo: 'PREVIEW' });
  const $ = cheerio.load(html);

  assert.match(html, /CERTIFICADO DE INSPECCION DEL VEHICULO A GLP/);
  assert.match(html, /<td class="val">GLP<\/td>/);
  assert.match(html, /GLP-ANUAL-002/);
  assert.equal($('table.comp-table tbody tr').length, 2);
  const tablaVehiculo = $('table.data-table').text();
  assert.match(tablaVehiculo, /4\s*\/\s*1600/);
  assert.match(tablaVehiculo, /02\s*\/\s*04/);
  assert.match(tablaVehiculo, /05\s*\/\s*04/);
  assert.match(tablaVehiculo, /4\.3\s*\/\s*1\.75\s*\/\s*1\.5/);
  assert.match(tablaVehiculo, /1301/);
  assert.match(tablaVehiculo, /1450/);
  assert.match(tablaVehiculo, /149/);
  assert.doesNotMatch(tablaVehiculo, /(?:1301|1450|149|1600)\.000/);
  assert.match($('table.comp-table tbody tr').first().text(), /45 LTS\s*\/\s*01-2019/);
  assert.equal($('table.comp-table tbody tr').first().find('td').first().text().trim(), '1');
  assert.equal($('table.comp-table tbody tr').eq(1).find('td').first().text().trim(), 'Q');
});

test('GNV Inicial: template no muestra fila de propietario, muestra componentes y conversion, sin 8 verificaciones', () => {
  const data = {
    cabecera: { numero_certificado: 'GNV-INI-001', fecha_emision: '2026-10-12' },
    taller: { nombre: 'TALLER GNV CENTRAL' },
    vehiculo: {
      placa: 'GNV100', categoria: 'M1', marca: 'HYUNDAI', modelo: 'ACCENT', version: 'GL',
      anio_fabricacion: '2021', vin: 'VIN-GNV-1', motor: 'MOT-G', cilindros: '4', cilindrada: '1400',
      combustible: 'GASOLINA', ejes: '2', ruedas: '4', asientos: '5', pasajeros: '4',
      longitud: '4.10', ancho: '1.70', altura: '1.45', color: 'AZUL', peso_neto: '1050', peso_bruto: '1450'
    },
    gnv: {
      combustible_posterior: 'BI - COMBUSTIBLE GNV',
      peso_neto_posterior: '1120'
    },
    componentes: [
      { componente: 'REDUCTOR', marca: 'TOMASETTO', numero_serie: 'RED-999', capacidad_litros: 'NO APLICA', mes_fabricacion: '02', anio_fabricacion: '2021' },
      { componente: 'CILINDRO', marca: 'INFLF', numero_serie: 'CIL-888', capacidad_litros: '55', mes_fabricacion: '03', anio_fabricacion: '2021' }
    ]
  };

  const html = generateGnvInicialHtml(data, { modo: 'PREVIEW' });
  const $ = cheerio.load(html);

  assert.match(html, /CERTIFICADO DE CONFORMIDAD DE CONVERSIÓN A GNV/);
  // Row 1 starts directly at Placa de Rodaje, not Propietario!
  assert.equal($('table.data-table').first().find('tr').first().find('td.num').first().text().trim(), '1');
  assert.equal($('table.data-table').first().find('tr').first().find('td.label').first().text().trim(), 'Placa de Rodaje');
  assert.doesNotMatch($('table.data-table').first().text(), /Propietario/i);

  // Components table present
  assert.equal($('table.comp-table tbody tr').length, 2);
  assert.match($('table.comp-table').text(), /TOMASETTO/);
  assert.match($('table.comp-table').text(), /INFLF/);

  // Conversion change present
  assert.match(html, /BI - COMBUSTIBLE GNV/);
  assert.match(html, /1120/);

  // No annual checks list (ol.verif-list)
  assert.equal($('ol.verif-list').length, 0);
});

test('GNV Anual: template no muestra propietario, sí muestra las 8 verificaciones y observaciones', () => {
  const data = {
    cabecera: { numero_certificado: 'GNV-ANUAL-001', fecha_emision: '2026-10-12', observaciones: 'VEHICULO EN BUEN ESTADO' },
    taller: { nombre: 'TALLER GNV CENTRAL' },
    vehiculo: {
      placa: 'GNV200', categoria: 'M1', marca: 'CHEVROLET', modelo: 'SAIL', version: 'LT',
      ano_fabricacion: '2020', vin: 'VIN-SAIL', motor: 'MOT-SAIL', cilindros: '4', cilindrada: '1500',
      combustible: 'BI-COMBUSTIBLE GNV', ejes: '2', ruedas: '4', asientos: '5', pasajeros: '4',
      longitud: '4.25', ancho: '1.69', altura: '1.50', color: 'BLANCO', peso_neto: '1100', peso_bruto: '1500'
    },
    gnv: { vigencia_hasta: '2027-10-12' },
    verificaciones: [
      { codigo: 'a', descripcion: 'Verif A', cumple: true },
      { codigo: 'b', descripcion: 'Verif B', cumple: true },
      { codigo: 'c', descripcion: 'Verif C', cumple: true },
      { codigo: 'd', descripcion: 'Verif D', cumple: true },
      { codigo: 'e', descripcion: 'Verif E', cumple: true },
      { codigo: 'f', descripcion: 'Verif F', cumple: true },
      { codigo: 'g', descripcion: 'Verif G', cumple: true },
      { codigo: 'h', descripcion: 'Verif H', cumple: true }
    ]
  };

  const html = generateGnvAnualHtml(data, { modo: 'PREVIEW' });
  const $ = cheerio.load(html);

  assert.match(html, /CERTIFICADO DE INSPECCION ANUAL DEL VEHICULO A GNV/);
  assert.match(html, /BI-COMBUSTIBLE GNV/);
  assert.match(html, /02 \/ 04/);
  assert.match(html, /05 \/ 04/);
  assert.equal($('table.data-table').first().find('tr').first().find('td.label').first().text().trim(), 'Placa de Rodaje');
  assert.doesNotMatch($('table.data-table').first().text(), /Propietario/i);

  // 8 checks present in ol.verif-list
  assert.equal($('ol.verif-list li').length, 8);
  assert.match($('.obs-sec').text(), /VEHICULO EN BUEN ESTADO/);
});

test('Conformidad: motor HTML_DINAMICO formato 114 usa tipo_conformidad, caracteristica_registrable y uso_original_vehiculo', () => {
  const plantilla = generateConformidadHtml.crearPlantillaConformidadHtml();

  const datosDinamicos = {
    certificado: { numero: 'CONF-001' },
    documento: { clase_preview: '', fecha_dia: '12', fecha_mes: 'OCTUBRE', fecha_anio: '2026' },
    titular: { nombre: 'CONSTRUCTORA PRUEBA S.A.C.', direccion: 'AV. FAREGAS 500' },
    vehiculo: {
      placa: 'CON123', clase: 'N2', categoria: 'N2', modelo: 'CANTER', marca: 'MITSUBISHI',
      serie_chasis: 'CANTER-SER-1', vin: 'CANTER-VIN-1', motor: 'CANTER-MOT-1', color: 'BLANCO',
      carroceria: 'FURGON', combustible: 'DIESEL', potencia: '110 / 2800', asientos: '3', pasajeros: '2',
      cilindrada: '2977', cilindros: '4', longitud: '5.90', altura: '2.80', ancho: '2.05',
      peso_bruto: '5500', peso_neto: '2800', carga_util: '2700', anio_fabricacion: '2022',
      anio_modelo: '2022', formula_rodante: '4x2', ejes: '2', ruedas: '6', version: '4.9T'
    },
    conformidad: {
      clase_modificacion: 'active', clase_montaje: '', clase_fabricacion: '',
      marca_modificacion: 'X', marca_montaje: '', marca_fabricacion: '',
      caracteristica_registrable: 'CAMBIO DE CARROCERÍA A FURGÓN ISOTÉRMICO',
      uso_original_vehiculo: 'MERCANCÍAS'
    }
  };

  const html = renderizarHtml(plantilla, datosDinamicos);
  const $ = cheerio.load(html);

  assert.match(html, /CERTIFICADO DE CONFORMIDAD/);
  assert.match(html, /CONSTRUCTORA PRUEBA S\.A\.C\./);
  assert.match(html, /AV\. FAREGAS 500/);
  assert.match(html, /CAMBIO DE CARROCERÍA A FURGÓN ISOTÉRMICO/);
  assert.match(html, /MERCANCÍAS/);
  assert.equal($('td.active').text().trim(), 'MODIFICACION');

  // Fields that were removed from UI must not appear in template:
  assert.doesNotMatch(html, /Trámite solicitado/i);
  assert.doesNotMatch(html, /Motivo de la solicitud/i);
  assert.doesNotMatch(html, /Descripción complementaria/i);
});
