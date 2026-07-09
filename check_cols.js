const pool = require('./config/database');

async function check() {
  const c = await pool.connect();
  const res = await c.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'inspeccion'");
  console.log(res.rows.map(r => r.column_name));
  c.release();
  process.exit(0);
}
check();
