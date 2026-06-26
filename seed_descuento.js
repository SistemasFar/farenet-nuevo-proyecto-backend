const pool = require('./config/database');

async function run() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Insertar el maestro del Descuento para el DNI 9999
    // asumiendo que id=999 no existe
    await client.query(`
      INSERT INTO descuento (
        id, nombre, estado, empresa_nrodocumentoidentidad, fechinicio, fechfin
      ) VALUES (
        999, 'CAMPAÑA VERANO AMBULANCIAS', true, '9999', NOW() - INTERVAL '1 day', NOW() + INTERVAL '10 days'
      ) ON CONFLICT DO NOTHING
    `);

    // Insertar el detalle del descuento (Concepto 30 - Ambulancia, monto 50 soles)
    await client.query(`
      INSERT INTO descuentodetalle (
        id, descuento_id, conceptoinspeccion_key, monto
      ) VALUES (
        999, 999, '30', 50.00
      ) ON CONFLICT DO NOTHING
    `);

    await client.query('COMMIT');
    console.log("¡Descuento promocional para DNI 9999 y concepto Ambulancia creado con éxito!");
  } catch (err) {
    await client.query('ROLLBACK');
    console.log(err);
  } finally {
    client.release();
  }
  process.exit(0);
}
run();
