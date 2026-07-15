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
      SELECT nrodocumentoinspeccion, inspeccionestado_key, resultado 
      FROM inspeccion 
      WHERE nrodocumentoinspeccion LIKE '%158749%'
    `);
    console.log(JSON.stringify(res.rows, null, 2));
    
    const res2 = await pool.query(`
      SELECT COUNT(*) FROM resultado_maquina
    `);
    console.log("Total resultado_maquina:", res2.rows[0].count);
    
  } catch (err) {
    console.error(err);
  } finally {
    pool.end();
  }
}
query();
