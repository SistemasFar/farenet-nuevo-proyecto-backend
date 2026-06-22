const pool = require('./config/database');
async function run() {
  try {
    const q = "SELECT * FROM inspeccion WHERE nrodocumentoinspeccion LIKE 'INS-201-%' ORDER BY CAST(SPLIT_PART(nrodocumentoinspeccion, '-', 3) AS INTEGER) DESC LIMIT 1";
    const r1 = await pool.query(q);
    console.log('LATEST INSPECCION:', r1.rows[0]);
    if(r1.rows.length > 0) {
      const nro = r1.rows[0].nrodocumentoinspeccion;
      const r2 = await pool.query("SELECT * FROM comprobante WHERE inspeccion_nrodocumentoinspeccion = $1", [nro]);
      console.log('COMPROBANTE:', r2.rows[0]);
      if(r2.rows.length > 0 && r2.rows[0].placamotor !== '-') {
        const r3 = await pool.query("SELECT * FROM vehiculo WHERE nroplacaantigua = $1", [r2.rows[0].placamotor]);
        console.log('VEHICULO:', r3.rows[0]);
      }
    }
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}
run();
