const pool = require('./config/database');
async function run() {
  try {
    const res = await pool.query(`
      SELECT dc.id, dc.placa, dc.uuid, dc.estado, d.nombre, dd.conceptoinspeccion_key
      FROM descuentocliente dc
      JOIN descuentodetalle dd ON dd.id = dc.descuentodetalle_id
      JOIN descuento d ON d.id = dd.descuento_id
      WHERE dc.placa = '123456'
    `);
    console.log(res.rows);
  } catch(e) { 
    console.error(e); 
  } finally { 
    process.exit(0); 
  }
}
run();
