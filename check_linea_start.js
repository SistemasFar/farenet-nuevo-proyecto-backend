const pool = require('./config/database');

async function check() {
  const c = await pool.connect();
  try {
    const res = await c.query(`
      SELECT 
        c.linea_key,
        i.posicion, 
        COUNT(*) as cnt
      FROM inspeccion i
      JOIN comprobante c ON i.nrodocumentoinspeccion = c.inspeccion_nrodocumentoinspeccion
      WHERE i.inspeccionestado_key IN ('CON', 'PEN') 
        AND i.posicion BETWEEN 5 AND 13
      GROUP BY c.linea_key, i.posicion
      ORDER BY c.linea_key, cnt DESC
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
