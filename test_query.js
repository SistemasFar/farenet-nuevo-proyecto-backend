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
    const queryRaw = `
      SELECT
        rm.id,
        rm.inspeccion_nrodocumentoinspeccion AS "inspeccionNrodocumentoinspeccion",
        m.tipomaquina_key AS "tipoMaquinaKey",
        rm.resultado,
        rm.maquina_id AS "maquinaId",
        rm.data,
        rm.fechcreacion AS "fechaCreacion",
        rm.fechmodi AS "fechaModificacion",
        rm.foto
      FROM resultado_maquina rm
      JOIN maquina m ON m.id = rm.maquina_id
      WHERE rm.inspeccion_nrodocumentoinspeccion = $1
      ORDER BY m.tipomaquina_key, rm.id;
    `;
    const res = await pool.query(queryRaw, ['INS-201-000158748']);
    console.log("Success! Found rows:", res.rows.length);
    if(res.rows.length > 0) {
      console.log("Tipos:", res.rows.map(r => r.tipoMaquinaKey).join(', '));
    }
  } catch (e) {
    console.error("Error in query:", e.message);
  } finally {
    pool.end();
  }
}
query();
