const pool = require('./config/database');
async function run() {
  try {
    const res = await pool.query("SELECT * FROM certificado c JOIN inspeccion i ON c.inspeccion_nrodocumentoinspeccion = i.nrodocumentoinspeccion JOIN comprobante co ON co.inspeccion_nrodocumentoinspeccion = i.nrodocumentoinspeccion WHERE co.placamotor = 'BSD014' LIMIT 1");
    console.log(res.rows);
  } catch(e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
}
run();
