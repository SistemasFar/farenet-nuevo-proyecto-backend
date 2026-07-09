const pool = require('./config/database');

async function check() {
  const c = await pool.connect();
  try {
    const res = await c.query(`
      SELECT 
        i.posicion, 
        COUNT(*) as cnt,
        i.tipoinspeccion_key, 
        v.combustible_key, 
        v.vehiculoclase_key
      FROM inspeccion i
      JOIN vehiculo v ON i.vehiculo_nromotor = v.nromotor
      WHERE i.inspeccionestado_key IN ('CON', 'PEN') 
        AND i.posicion BETWEEN 5 AND 13
      GROUP BY i.posicion, i.tipoinspeccion_key, v.combustible_key, v.vehiculoclase_key
      ORDER BY cnt DESC
      LIMIT 30
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
