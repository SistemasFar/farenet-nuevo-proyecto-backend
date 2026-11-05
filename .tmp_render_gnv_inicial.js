const fs = require('fs');
const path = require('path');
const generateGnvInicialHtml = require('./modules/faregas/templates/gnv-inicial.template');

const outputDir = path.join(__dirname, '.tmp_gnv_inicial_reference');
fs.mkdirSync(outputDir, { recursive: true });

const data = {
  cabecera: {
    numero_certificado: 'DG-41-000999',
    fecha_emision: '2026-07-30T12:00:00-05:00',
    observaciones: ''
  },
  vehiculo: {
    placa: 'BFG445',
    categoria: 'M1',
    marca: 'KIA',
    modelo: 'CERATO',
    version: '1.6 AT EX PLUS',
    anio_fabricacion: '2017',
    vin: 'KNAFX511BJ5746998',
    motor: 'G4FGGH635504',
    cilindros: 4,
    cilindrada: 1591,
    combustible: 'GASOLINA',
    ejes: 2,
    ruedas: 4,
    asientos: 5,
    pasajeros: 4,
    longitud: 4.35,
    ancho: 1.78,
    altura: 1.46,
    color: 'AZUL GRAVEDAD',
    peso_neto: 1393,
    peso_bruto: 1720
  },
  gnv: {
    taller_planta_key: 98,
    taller_razon_social: 'CONVERTIGAS S.A.C FAREGAS I',
    combustible_posterior: 'BI - COMBUSTIBLE GNV',
    peso_neto_posterior: 1453
  },
  componentes: [
    { orden: 1, componente: 'Reductor', marca: 'TOMASETTO ACHILLE', numero_serie: 'E035321', capacidad_litros: 'NO APLICA', mes_fabricacion: 2, anio_fabricacion: 2026 },
    { orden: 2, componente: 'Cilindro (s)', marca: 'YA', numero_serie: 'N26025143', capacidad_litros: 55, mes_fabricacion: 4, anio_fabricacion: 2026 }
  ]
};

for (const mode of ['FINAL', 'PREVIEW']) {
  const html = generateGnvInicialHtml(data, { modo: mode });
  fs.writeFileSync(path.join(outputDir, `gnv-inicial-${mode.toLowerCase()}.html`), html, 'utf8');
}

const longData = JSON.parse(JSON.stringify(data));
longData.vehiculo.marca = 'FABRICANTE VEHICULAR DE DENOMINACIÓN EXTENDIDA';
longData.vehiculo.modelo = 'MODELO COMERCIAL CON TEXTO EXTENDIDO';
longData.vehiculo.version = 'VERSIÓN TÉCNICA ESPECIAL DE LARGA DENOMINACIÓN';
longData.vehiculo.color = 'AZUL METÁLICO CON ACABADO ESPECIAL';
longData.componentes.push(
  { orden: 3, componente: 'Válvula de cilindro con descripción extendida', marca: 'MARCA EXTENDIDA', numero_serie: 'SERIE-EXTENDIDA-00000003', capacidad_litros: 80, mes_fabricacion: 10, anio_fabricacion: 2026 },
  { orden: 4, componente: 'Dispositivo adicional', marca: 'OTRA MARCA', numero_serie: 'SERIE-00000004', capacidad_litros: 60, mes_fabricacion: 11, anio_fabricacion: 2026 }
);
fs.writeFileSync(
  path.join(outputDir, 'gnv-inicial-long.html'),
  generateGnvInicialHtml(longData, { modo: 'FINAL' }),
  'utf8'
);
