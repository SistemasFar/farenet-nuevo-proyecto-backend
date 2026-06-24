const { guardarInspeccionTransaccion } = require('./services/guardar_inspeccion.service');
const pool = require('./config/database');

const testPayload = {
  formCaja: {
    plantaKey: '201',
    placa: 'TEST1234',
    concepto: '30',
    linea: 'L1_MIXTA',
    tipoAutorizacion: '1',
    tipoCertificado: '21',
    tipoInspeccion: '7'
  },
  formVehiculo: {
    nroDocProp: '88888888',
    nombresProp: 'Prueba',
    apellidosProp: 'Sistema',
    nroMotor: 'TESTMOTOR999',
    placaNueva: 'TEST1234',
    marca: '62',
    modelo: '1725',
    nroSoat: '999999999'
  },
  formFacturacion: {
    tipoComprobante: 'BOLETA',
    total: 100,
    subtotal: 84.75,
    igv: 15.25
  },
  formVerificacion: {
    linea: 'L1_MIXTA'
  },
  pagosAgregados: [
    {
      tipo: 'EFECTIVO',
      importe: '50'
    },
    {
      tipo: 'TARJETA',
      importe: '50',
      tarjetaKey: 'VISA', // Ej. 1, 2
      nroOperacion: '123456',
      digitosTarjeta: '4321'
    }
  ]
};

async function runTest() {
  try {
    console.log("Iniciando prueba de guardado...");
    const result = await guardarInspeccionTransaccion(testPayload);
    console.log("Resultado del guardado:", result);

    console.log("\n--- VERIFICANDO EN BASE DE DATOS ---");
    
    // Verificamos inspeccion
    const insp = await pool.query("SELECT * FROM inspeccion WHERE nrodocumentoinspeccion = $1", [result.nroInspeccion]);
    console.log("Inspeccion insertada:", insp.rows[0].nrodocumentoinspeccion, "| comprobante_id:", insp.rows[0].comprobante_id);
    
    // Verificamos comprobante
    const comp = await pool.query("SELECT * FROM comprobante WHERE id = $1", [result.comprobanteId]);
    console.log("Comprobante insertado:", comp.rows[0].nrocomprobante, "| placa:", comp.rows[0].placamotor, "| total:", comp.rows[0].importetotal);
    
    // Verificamos vehiculo
    const veh = await pool.query("SELECT * FROM vehiculo WHERE nromotor = $1", [result.vehiculoId]);
    console.log("Vehiculo insertado:", veh.rows[0].nromotor, "| placa antigua:", veh.rows[0].nroplacaantigua);
    
    // Verificamos persona
    const per = await pool.query("SELECT * FROM persona WHERE nrodocumentoidentidad = $1", [testPayload.formVehiculo.nroDocProp]);
    console.log("Persona insertada:", per.rows[0].nombres, per.rows[0].apellidos);
    
    // Verificamos pagos
    const pagos = await pool.query("SELECT * FROM pago WHERE comprobante_id = $1", [result.comprobanteId]);
    console.log("\nPagos insertados:", pagos.rows.length);
    pagos.rows.forEach((p, idx) => {
      console.log(`Pago ${idx + 1}: S/${p.importe} | Tarjeta: ${p.tarjeta_key} | Nro Op: ${p.nrooperaciontarjeta}`);
    });
    
  } catch (err) {
    console.error("Error en la prueba:", err);
  } finally {
    process.exit(0);
  }
}

runTest();
