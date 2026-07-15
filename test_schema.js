const { Pool } = require('pg');
const pool = new Pool({
  user: 'postgres',
  host: '192.168.14.19',
  database: 'inspeccion',
  password: 'farenet2026**',
  port: 5432,
});
async function query() {
  try {
    const res = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'maquina'`);
    console.log("maquina columns:");
    console.log(res.rows.map(r => r.column_name));
    pool.end();
  } catch (e) {
    console.error(e);
    pool.end();
  }
}
query();
