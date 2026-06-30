const pool = require('./config/database');

async function runSeeds() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    console.log("Iniciando inyección de descuentos para DSC-123...");

    // Insertar en descuento
    let maxDescId = 1000000;
    try {
      const res = await client.query('SELECT MAX(id) as m FROM descuento');
      maxDescId = (res.rows[0].m || 1000000) + 1;
    } catch (e) {}

    await client.query(`
      INSERT INTO descuento (id, nombre, estado, fechinicio, fechfin)
      VALUES ($1, 'PROMO VERANO', true, NOW() - INTERVAL '1 day', NOW() + INTERVAL '30 days')
    `, [maxDescId]);

    // Insertar en descuentodetalle
    let maxDetId = 1000000;
    try {
      const res = await client.query('SELECT MAX(id) as m FROM descuentodetalle');
      maxDetId = (res.rows[0].m || 1000000) + 1;
    } catch (e) {}

    await client.query(`
      INSERT INTO descuentodetalle (id, descuento_id, monto, conceptoinspeccion_key)
      VALUES ($1, $2, 20.00, (SELECT key FROM conceptoinspeccion LIMIT 1))
    `, [maxDetId, maxDescId]);

    // Insertar en descuentocliente
    let maxCliId = 1000000;
    try {
      const res = await client.query('SELECT MAX(id) as m FROM descuentocliente');
      maxCliId = (res.rows[0].m || 1000000) + 1;
    } catch (e) {}

    await client.query(`
      INSERT INTO descuentocliente (id, descuentodetalle_id, placa, estado)
      VALUES ($1, $2, 'DSC-123', true)
    `, [maxCliId, maxDetId]);

    await client.query('COMMIT');
    console.log("Descuento insertado correctamente para DSC-123!");
  } catch (e) {
    await client.query('ROLLBACK');
    console.error("Error:", e.message);
  } finally {
    client.release();
    process.exit();
  }
}
runSeeds();
