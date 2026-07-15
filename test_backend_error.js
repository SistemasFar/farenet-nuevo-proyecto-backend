const db = require('./config/database');

async function test() {
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
  try {
    const { rows } = await db.query(queryRaw, ['INS-201-000158748']);
    console.log("Success. Rows:", rows.length);
  } catch (e) {
    console.error("EXACT BACKEND ERROR:", e.message);
  } finally {
    process.exit(0);
  }
}
test();
