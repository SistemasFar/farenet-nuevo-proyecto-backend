const pool = require('./config/database');

async function check() {
  const c = await pool.connect();
  const res = await c.query("SELECT * FROM tmp_inspeccion LIMIT 10");
  console.log(res.rows);
  c.release();
  process.exit(0);
}
check();
