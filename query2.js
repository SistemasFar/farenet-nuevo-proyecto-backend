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
    const res = await pool.query("SELECT r.maquina_id, m.tipomaquina_key, r.resultado, r.data FROM resultado_maquina r LEFT JOIN maquina m ON r.maquina_id = m.id WHERE r.inspeccion_nrodocumentoinspeccion = 'INS-201-000160569'");
    console.log(JSON.stringify(res.rows, null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    pool.end();
  }
}
query();
