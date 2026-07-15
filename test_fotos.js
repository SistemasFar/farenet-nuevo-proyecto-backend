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
    const queryStr = `
        SELECT
          rm.id,
          m.tipomaquina_key,
          rm.resultado,
          rm.fechcreacion,
          left(rm.data::text, 200) AS data_inicio,
          length(rm.data::text) AS data_len
      FROM resultado_maquina rm
      JOIN maquina m ON m.id = rm.maquina_id
      WHERE rm.inspeccion_nrodocumentoinspeccion LIKE 'INS-201-000158749%'
        AND m.tipomaquina_key IN ('11','12','13','15')
      ORDER BY m.tipomaquina_key, rm.id;
    `;
    const res = await pool.query(queryStr);
    console.log(JSON.stringify(res.rows, null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    pool.end();
  }
}
query();
