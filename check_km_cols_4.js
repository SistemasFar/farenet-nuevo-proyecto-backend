const pool = require('./config/database');
async function run() {
  try {
    const res = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_name LIKE '%vehiculo%'");
    console.log("tables:", res.rows.map(r => r.table_name).join(', '));
  } catch (err) {
    console.error(err);
  } finally {
    pool.end();
  }
}
run();
