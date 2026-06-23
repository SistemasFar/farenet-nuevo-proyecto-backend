const { Pool } = require('pg');
const pool = new Pool({
  user: 'postgres',
  host: '192.168.14.19',
  database: 'inspeccion',
  password: 'farenet2026**',
  port: 5432
});

async function run() {
  try {
    const res = await pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'pago'");
    console.table(res.rows);
  } catch (e) {
    console.error(e);
  } finally {
    pool.end();
  }
}
run();
