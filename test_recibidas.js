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
    const queryRecibidas = `
        SELECT
          rm.id,
          rm.resultado,
          rm.maquina_id,
          m.tipomaquina_key,
          tm.descripcion AS nombre,
        rm.fechcreacion,
        rm.fechainicio,
        rm.fechafin,
        rm.foto,
        rm.data
      FROM resultado_maquina rm
      JOIN maquina m ON m.id = rm.maquina_id
      JOIN tipomaquina tm ON tm.key = m.tipomaquina_key
      WHERE rm.inspeccion_nrodocumentoinspeccion LIKE 'INS-201-000158749%'
    `;
    const res = await pool.query(queryRecibidas);
    console.log(JSON.stringify(res.rows, null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    pool.end();
  }
}
query();
