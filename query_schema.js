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
    const res = await pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'resultado_maquina'");
    console.log(JSON.stringify(res.rows, null, 2));
    
    // also let's fetch one photo!
    const res2 = await pool.query("SELECT foto FROM resultado_maquina WHERE foto IS NOT NULL LIMIT 1");
    if(res2.rows.length > 0) console.log("Has foto!");
  } catch (err) {
    console.error(err);
  } finally {
    pool.end();
  }
}
query();
