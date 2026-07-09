const pool = require('./config/database');

async function check() {
  const c = await pool.connect();
  const res = await c.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'inspeccion' AND column_name LIKE 'fech%'");
  console.log(res.rows);
  c.release();
  process.exit(0);
}
check();
