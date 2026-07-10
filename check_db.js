const pool = require('./config/database');

async function run() {
  console.log("=== LATEST INSPECTION ===");
  const latestIns = await pool.query(`
    SELECT
      nrodocumentoinspeccion,
      inspeccionestado_key,
      posicion,
      fechaenlinea,
      fechconsolidado,
      fechcreacion,
      fechmodi
    FROM inspeccion
    ORDER BY fechcreacion DESC
    LIMIT 1
  `);
  
  if (latestIns.rows.length > 0) {
    const nro = latestIns.rows[0].nrodocumentoinspeccion;
    console.table(latestIns.rows);
    
    console.log("\n=== COMPROBANTE COUNT ===");
    const compCount = await pool.query(`
      SELECT COUNT(*) AS cantidad
      FROM comprobante
      WHERE inspeccion_nrodocumentoinspeccion = $1
    `, [nro]);
    console.table(compCount.rows);
    
    console.log("\n=== RECENT INSPECTIONS (DUPLICATE CHECK) ===");
    const prefix = nro.substring(0, 11) + '%';
    const recent = await pool.query(`
      SELECT nrodocumentoinspeccion, inspeccionestado_key, posicion, fechaenlinea, fechcreacion
      FROM inspeccion
      WHERE nrodocumentoinspeccion LIKE $1
      ORDER BY fechcreacion DESC
      LIMIT 5
    `, [prefix]);
    console.table(recent.rows);
  }
  
  process.exit(0);
}

run().catch(console.error);
