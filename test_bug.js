require('dotenv').config();
const pool = require('./config/database');

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function checkStatus(nro, stepName) {
  const res = await pool.query('SELECT inspeccionestado_key, posicion, estado FROM inspeccion WHERE nrodocumentoinspeccion = $1', [nro]);
  console.log(`\n[TEST] Después de ${stepName}:`);
  if (res.rows.length > 0) {
    console.log(`  -> inspeccionestado_key: ${res.rows[0].inspeccionestado_key}, posicion: ${res.rows[0].posicion}, estado_booleano: ${res.rows[0].estado}`);
  } else {
    console.log(`  -> Fila no encontrada.`);
  }
}

async function runTest() {
  const nroInspeccion = 'INS-201-999999999';
  console.log(`Iniciando prueba con NRO: ${nroInspeccion}`);

  const service = require('./services/inspecciones_proceso.service.js');

  async function callStep(payload, stepName) {
    console.log(`\nEjecutando paso: ${stepName}...`);
    try {
      await service.guardarProceso(payload);
      await delay(1500); // Wait for legacy triggers/jobs
      await checkStatus(nroInspeccion, stepName);
    } catch(err) {
      console.error('Error llamando service', err);
    }
  }

  // PASO 1: CAJA
  await callStep({
    nrodocumentoinspeccion: nroInspeccion,
    posicion: 1,
    formCaja: {
      plantaKey: '201',
      tipoAutorizacion: '1',
      tipoCertificado: '1',
      tipoInspeccion: '1',
      placa: 'A1B-234'
    }
  }, 'Dar siguiente en CAJA');

  // PASO 2: PAGO
  await callStep({
    nrodocumentoinspeccion: nroInspeccion,
    posicion: 2,
    formCaja: {
      plantaKey: '201',
      tipoAutorizacion: '1',
      tipoCertificado: '1',
      tipoInspeccion: '1',
      placa: 'A1B-234'
    },
    formPago: [
      { tipoPago: 'EFECTIVO', importe: 100 }
    ]
  }, 'Dar siguiente en PAGO');

  // PASO 3: VEHICULO
  await callStep({
    nrodocumentoinspeccion: nroInspeccion,
    posicion: 3,
    formVehiculo: {
      placaNueva: 'A1B-234',
      nroMotor: 'MOT123'
    }
  }, 'Dar siguiente en VEHICULO');

  // PASO 4: FINALIZAR
  const gService = require('./services/guardar_inspeccion.service.js');
  console.log(`\nEjecutando paso: FINALIZAR...`);
  try {
    await gService.guardarInspeccionTransaccion({
      nrodocumentoinspeccion: nroInspeccion,
      plantaKey: '201',
      formCaja: {
        plantaKey: '201',
        tipoAutorizacion: '1',
        tipoCertificado: '1',
        tipoInspeccion: '1',
        placa: 'A1B-234'
      },
      formVehiculo: {
        placaNueva: 'A1B-234',
        nroMotor: 'MOT123'
      },
      formFacturacion: {
        tipoComprobante: 'BOLETA'
      }
    });
    await delay(1500);
    await checkStatus(nroInspeccion, 'FINALIZAR');
  } catch(e) {
    console.error('Error FINALIZAR:', e.message);
  }

  process.exit(0);
}

runTest();
