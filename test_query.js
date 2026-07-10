const pool = require('./config/database');
async function run() {
  const c = await pool.query("SELECT * FROM vehiculo LIMIT 1");
  console.log(c.rows[0]);
  process.exit(0);
}
run();
