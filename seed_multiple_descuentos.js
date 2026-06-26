const pool = require('./config/database');

async function run() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Descuento 2
    await client.query(`
      INSERT INTO descuento (
        id, nombre, estado, empresa_nrodocumentoidentidad, fechinicio, fechfin
      ) VALUES (
        998, 'PROMOCIÓN INVIERNO', true, '9999', NOW() - INTERVAL '1 day', NOW() + INTERVAL '10 days'
      ) ON CONFLICT DO NOTHING
    `);
    await client.query(`
      INSERT INTO descuentodetalle (
        id, descuento_id, conceptoinspeccion_key, monto
      ) VALUES (
        998, 998, '30', 20.00
      ) ON CONFLICT DO NOTHING
    `);

    // Descuento 3
    await client.query(`
      INSERT INTO descuento (
        id, nombre, estado, empresa_nrodocumentoidentidad, fechinicio, fechfin
      ) VALUES (
        997, 'DESCUENTO ESPECIAL DE GERENCIA', true, '9999', NOW() - INTERVAL '1 day', NOW() + INTERVAL '10 days'
      ) ON CONFLICT DO NOTHING
    `);
    await client.query(`
      INSERT INTO descuentodetalle (
        id, descuento_id, conceptoinspeccion_key, monto
      ) VALUES (
        997, 997, '30', 15.00
      ) ON CONFLICT DO NOTHING
    `);

    await client.query('COMMIT');
    console.log("¡Múltiples descuentos inyectados para el DNI/RUC 9999!");
  } catch (err) {
    await client.query('ROLLBACK');
    console.log(err);
  } finally {
    client.release();
  }
  process.exit(0);
}
run();
