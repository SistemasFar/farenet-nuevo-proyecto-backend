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
      JOIN maquina m ON rm.maquina_id = m.id
      WHERE rm.inspeccion_nrodocumentoinspeccion = 'INS-201-000158749M'
      ORDER BY m.tipomaquina_key, rm.id;
    `);
    
    console.log("Found rows:", res.rows.length);
    console.log("Tipos de maquina found:", [...new Set(res.rows.map(r => r.tipomaquina_key))]);
    
    // Check if we have types 11, 12, 13, 15
    const fotos = res.rows.filter(r => ['11', '12', '13', '15'].includes(r.tipomaquina_key));
    if (fotos.length > 0) {
      console.log("Fotos found for types:", fotos.map(f => f.tipomaquina_key));
      console.log("Data sample:", typeof fotos[0].data, typeof fotos[0].data === 'string' ? "String" : "Object", Object.keys(fotos[0].data || {}));
      console.log("Foto column contains:", typeof fotos[0].foto, fotos[0].foto ? fotos[0].foto.substring(0, 30) : "null");
    }
  } catch (err) {
    console.error(err);
  } finally {
    pool.end();
  }
}
query();
