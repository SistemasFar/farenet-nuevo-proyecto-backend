const pool = require('./config/database');

async function run() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    await client.query("UPDATE comprobante SET conceptoinspeccion_key = '30' WHERE placamotor = 'TES123'");
    
    await client.query('COMMIT');
    console.log("¡Concepto actualizado a 30 (Ambulancia)!");
  } catch (err) {
    await client.query('ROLLBACK');
    console.log(err);
  } finally {
    client.release();
  }
  process.exit(0);
}
run();
