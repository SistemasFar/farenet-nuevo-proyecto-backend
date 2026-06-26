const pool = require('./config/database');

async function run() {
  try {
    const res = await pool.query(`
      SELECT 
        v.nroplacaantigua as placa,
        i.nrodocumentoinspeccion,
        i.fechconsolidado,
        i.resultado,
        i.inspeccionestado_key
      FROM vehiculo v
      JOIN comprobante c ON c.placamotor = v.nroplacaantigua
      JOIN inspeccion i ON i.nrodocumentoinspeccion = c.inspeccion_nrodocumentoinspeccion
      WHERE i.resultado = 'D' AND i.inspeccionestado_key = 'CON'
      ORDER BY i.fechconsolidado DESC
      LIMIT 5
    `);
    console.log(JSON.stringify(res.rows, null, 2));
  } catch (err) {
    console.log(err);
  }
  process.exit(0);
}
run();
