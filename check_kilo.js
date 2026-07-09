const pool = require('./config/database');

async function check() {
  const c = await pool.connect();
  const res = await c.query("SELECT table_name, column_name FROM information_schema.columns WHERE column_name LIKE '%kilo%'");
  console.log(res.rows);
  c.release();
  process.exit(0);
}
check();
