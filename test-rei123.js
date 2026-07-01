const pool = require('./config/database');
async function run() {
  try {
    const res = await pool.query("SELECT i.nrodocumentoinspeccion, c.conceptoinspeccion_key, i.fechconsolidado, i.resultado FROM inspeccion i JOIN comprobante c ON c.inspeccion_nrodocumentoinspeccion = i.nrodocumentoinspeccion WHERE c.placamotor = 'REI-123' ORDER BY i.fechconsolidado DESC");
    console.log(res.rows);
  } catch(e) { console.error(e); } finally { process.exit(0); }
}
run();
