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
    const res = await pool.query(`
      SELECT inspeccion_nrodocumentoinspeccion, maquina_id, resultado 
      FROM resultado_maquina 
      WHERE inspeccion_nrodocumentoinspeccion LIKE '%158749%'
    `);
    console.log(JSON.stringify(res.rows, null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    pool.end();
  }
}
query();
