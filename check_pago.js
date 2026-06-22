const pool = require('./config/database');
async function run() {
  try {
    const q = await pool.query("SELECT DISTINCT tipocontado_key FROM pago");
    console.log(q.rows);
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}
run();
