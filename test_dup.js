const pool = require('./config/database');
async function test() {
  const res = await pool.query("SELECT pl.nombre as nombre_sede FROM inspeccion i JOIN comprobante c ON c.inspeccion_nrodocumentoinspeccion = i.nrodocumentoinspeccion LEFT JOIN planta pl ON pl.key = SPLIT_PART(i.nrodocumentoinspeccion, '-', 2) WHERE c.placamotor = 'YEO123'");
  console.log(res.rows);
  process.exit(0);
}
test();
