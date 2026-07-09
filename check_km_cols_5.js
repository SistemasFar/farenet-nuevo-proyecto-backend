const pool = require('./config/database');
async function run() {
  try {
    const res = await pool.query("SELECT * FROM vehiculo_aud LIMIT 1");
    console.log("vehiculo_aud:", res.rows);
  } catch (err) {
    console.error(err);
  } finally {
    pool.end();
  }
}
run();
