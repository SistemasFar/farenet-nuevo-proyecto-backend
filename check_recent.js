const pool = require('./config/database');
async function test() {
  try {
    const res = await pool.query("SELECT i.nrodocumentoinspeccion, i.inspeccionestado_key, i.fechcreacion, c.placamotor FROM inspeccion i JOIN comprobante c ON c.inspeccion_nrodocumentoinspeccion = i.nrodocumentoinspeccion ORDER BY i.fechcreacion DESC LIMIT 5");
    console.log(res.rows);
  } catch(e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
}
test();
