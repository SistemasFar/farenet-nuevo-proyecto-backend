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
      SELECT
        rm.id,
        rm.inspeccion_nrodocumentoinspeccion,
        rm.maquina_id,
        m.tipomaquina_key,
        rm.resultado,
        rm.data,
        rm.foto,
        rm.fechcreacion,
        rm.fechmodi
      FROM resultado_maquina rm
      LEFT JOIN maquina m ON rm.maquina_id = m.id
      WHERE rm.inspeccion_nrodocumentoinspeccion = 'INS-201-000158749'
      ORDER BY m.tipomaquina_key, rm.id;
    `);
    console.log(JSON.stringify(res.rows, null, 2));
    if(res.rows.length === 0) {
      console.log("No results for INS-201-000158749 in resultado_maquina");
    }
  } catch (err) {
    console.error(err);
  } finally {
    pool.end();
  }
}
query();
