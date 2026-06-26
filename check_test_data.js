const pool = require('./config/database');

async function run() {
  try {
    const res = await pool.query(`
      SELECT 
        v.nroplacaantigua as placa,
        c.cliente_nrodocumentoidentidad as dni_ruc,
        p.nombres,
        p.apellidos,
        p.nombrerazonsocial,
        i.nrodocumentoinspeccion,
        i.fechcreacion,
        i.resultado,
        i.inspeccionestado_key
      FROM vehiculo v
      JOIN comprobante c ON c.placamotor = v.nroplacaantigua
      JOIN persona p ON p.nrodocumentoidentidad = c.cliente_nrodocumentoidentidad
      JOIN inspeccion i ON i.nrodocumentoinspeccion = c.inspeccion_nrodocumentoinspeccion
      WHERE v.nroplacaantigua IS NOT NULL AND v.nroplacaantigua != ''
      ORDER BY i.fechcreacion DESC
      LIMIT 10
    `);
    console.log(JSON.stringify(res.rows, null, 2));
  } catch (err) {
    console.log(err);
  }
  process.exit(0);
}
run();
