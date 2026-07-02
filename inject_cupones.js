const pool = require('./config/database');

async function inject() {
  try {
    const descuentoId = '17926942'; // ID de Cuponidad (aliestrategica)
    const concepto = '1'; // Inspeccion Tecnica Vehicular

    // 1. Insertar Descuento Detalle FLAT
    await pool.query(`
      INSERT INTO descuentodetalle (
        id, fechcreacion, fechfin, fechinicio, monto, montoactivacion, estado, conceptoinspeccion_key, 
        descuento_id, formapago_key, planta_key, tipopagodescuento_key
      ) VALUES (
        9990001, CURRENT_TIMESTAMP, '2030-12-31', CURRENT_TIMESTAMP, 50.00, 50.00, true, $1, $2, 'contado', '201', 'FLA'
      )
    `, [concepto, descuentoId]);

    // 2. Insertar Descuento Detalle MONTO
    await pool.query(`
      INSERT INTO descuentodetalle (
        id, fechcreacion, fechfin, fechinicio, monto, montoactivacion, estado, conceptoinspeccion_key, 
        descuento_id, formapago_key, planta_key, tipopagodescuento_key
      ) VALUES (
        9990002, CURRENT_TIMESTAMP, '2030-12-31', CURRENT_TIMESTAMP, 30.00, 30.00, true, $1, $2, 'contado', '201', 'MON'
      )
    `, [concepto, descuentoId]);

    // 3. Insertar Descuento Detalle PORCENTAJE
    await pool.query(`
      INSERT INTO descuentodetalle (
        id, fechcreacion, fechfin, fechinicio, monto, montoactivacion, estado, conceptoinspeccion_key, 
        descuento_id, formapago_key, planta_key, tipopagodescuento_key
      ) VALUES (
        9990003, CURRENT_TIMESTAMP, '2030-12-31', CURRENT_TIMESTAMP, 25.00, 25.00, true, $1, $2, 'contado', '201', 'POR'
      )
    `, [concepto, descuentoId]);

    // Ahora insertamos los cupones en descuentocliente
    
    // Cupn 1: FLAT
    await pool.query(`
      INSERT INTO descuentocliente (id, diasempieza, estado, fechinicio, maxinspecciones, uuid, descuentodetalle_id)
      VALUES (9990010, '0', true, CURRENT_TIMESTAMP, '1', 'FLAT-50-CUPON', 9990001)
    `);

    // Cupn 2: MONTO
    await pool.query(`
      INSERT INTO descuentocliente (id, diasempieza, estado, fechinicio, maxinspecciones, uuid, descuentodetalle_id)
      VALUES (9990011, '0', true, CURRENT_TIMESTAMP, '1', 'MONTO-30-CUPON', 9990002)
    `);

    // Cupn 3: PORCENTAJE
    await pool.query(`
      INSERT INTO descuentocliente (id, diasempieza, estado, fechinicio, maxinspecciones, uuid, descuentodetalle_id)
      VALUES (9990012, '0', true, CURRENT_TIMESTAMP, '1', 'PORC-25-CUPON', 9990003)
    `);

    console.log("CUPONES INSERTADOS CON EXITO");
  } catch(e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
}
inject();
