const pool = require('./config/database');

async function run() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    await client.query("UPDATE comprobante SET placamotor = 'TES123' WHERE placamotor = 'TEST1234'");
    await client.query("UPDATE vehiculo SET nroplacaantigua = 'TES123' WHERE nroplacaantigua = 'TEST1234'");
    
    await client.query('COMMIT');
    console.log("¡Placa actualizada a TES123!");
  } catch (err) {
    await client.query('ROLLBACK');
    console.log(err);
  } finally {
    client.release();
  }
  process.exit(0);
}
run();
