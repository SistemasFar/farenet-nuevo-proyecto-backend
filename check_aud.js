const pool = require('./config/database');

async function check() {
  const c = await pool.connect();
  const res = await c.query("SELECT * FROM vehiculo_aud ORDER BY id DESC LIMIT 5");
  console.log(res.rows);
  c.release();
  process.exit(0);
}
check();
