const pool = require('./config/database');

async function run() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Descuento 1 para 323232
    await client.query(`
      INSERT INTO descuento (
        id, nombre, estado, empresa_nrodocumentoidentidad, fechinicio, fechfin
      ) VALUES (
        3201, 'DESCUENTO EMPLEADO FARENET', true, '323232', NOW() - INTERVAL '1 day', NOW() + INTERVAL '10 days'
      ) ON CONFLICT DO NOTHING
    `);
    await client.query(`
      INSERT INTO descuentodetalle (
        id, descuento_id, conceptoinspeccion_key, monto
      ) VALUES (
        3201, 3201, '30', 25.00
      ) ON CONFLICT DO NOTHING
    `);
    
    // Descuento para Ambulancia u otros (key 3)
    await client.query(`
      INSERT INTO descuentodetalle (id, descuento_id, conceptoinspeccion_key, monto) 
      VALUES (3203, 3201, '3', 10.00) ON CONFLICT DO NOTHING
    `);

    await client.query('COMMIT');
    console.log("¡Múltiples descuentos inyectados para el DNI/RUC 323232!");
  } catch (err) {
    await client.query('ROLLBACK');
    console.log(err);
  } finally {
    client.release();
  }
  process.exit(0);
}
run();
