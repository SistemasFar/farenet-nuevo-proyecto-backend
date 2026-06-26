const pool = require('./config/database');
async function run() {
  const client = await pool.connect();
  try {
    await client.query(`
      UPDATE vehiculo SET 
        categoria_key = 'M1'
      WHERE nroplacaantigua = 'VIEJ11'
    `);
    console.log("Categoria actualizada a M1");
  } finally {
    client.release();
    process.exit(0);
  }
}
run();
