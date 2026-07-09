const pool = require('./config/database');

async function check() {
  const c = await pool.connect();
  const res = await c.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'tmp_inspeccion'");
  console.log(res.rows);
  c.release();
  process.exit(0);
}
check();
