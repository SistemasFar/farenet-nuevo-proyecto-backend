const pool = require('./config/database');

async function inject100Porc() {
  try {
    const descuentoId = '17926942'; // ID de Cuponidad (aliestrategica)
    const concepto = '1'; // Inspeccion Tecnica Vehicular

    // Insertar Descuento Detalle PORCENTAJE 100%
    await pool.query(`
      INSERT INTO descuentodetalle (
        id, fechcreacion, fechfin, fechinicio, monto, montoactivacion, estado, conceptoinspeccion_key, 
        descuento_id, formapago_key, planta_key, tipopagodescuento_key
      ) VALUES (
        9990004, CURRENT_TIMESTAMP, '2030-12-31', CURRENT_TIMESTAMP, 100.00, 100.00, true, $1, $2, 'contado', '201', 'POR'
      )
    `, [concepto, descuentoId]);

    // Insertar Cupn 100%
    await pool.query(`
      INSERT INTO descuentocliente (id, diasempieza, estado, fechinicio, maxinspecciones, uuid, descuentodetalle_id)
      VALUES (9990013, '0', true, CURRENT_TIMESTAMP, '1', 'PORC-100-GRATIS', 9990004)
    `);

    console.log("CUPON DE 100% INSERTADO CON EXITO");
  } catch(e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
}
inject100Porc();
