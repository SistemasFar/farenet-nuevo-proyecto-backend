const pool = require('./config/database');
async function run() {
  const res = await pool.query("SELECT * FROM vehiculo WHERE nroplacaantigua = 'TEST01'");
  console.log(res.rows);
  process.exit(0);
}
run();
