const pool = require('./config/database');

async function check() {
  const c = await pool.connect();
  try {
    const res = await c.query(`
      SELECT 
        i.nrodocumentoinspeccion, 
        i.posicion, 
        i.tipoinspeccion_key, 
        v.combustible_key, 
        v.vehiculoclase_key, 
        c.conceptoinspeccion_key
      FROM inspeccion i
      JOIN vehiculo v ON i.vehiculo_nromotor = v.nromotor
      JOIN comprobante c ON i.nrodocumentoinspeccion = c.inspeccion_nrodocumentoinspeccion
      WHERE i.inspeccionestado_key IN ('CON', 'PEN') 
        AND i.posicion IN (5, 6, 7, 8)
      ORDER BY i.fechcreacion DESC
      LIMIT 20
    `);
    console.table(res.rows);
  } catch (e) {
    console.error(e);
  } finally {
    c.release();
    process.exit(0);
  }
}
check();
