const pool = require('./config/database');
async function test() {
  try {
    const res = await pool.query(`
      SELECT dc.uuid, d.nombre
      FROM descuentocliente dc
      JOIN descuentodetalle dd ON dd.id = dc.descuentodetalle_id
      JOIN descuento d ON d.id = dd.descuento_id
      WHERE d.nombre ILIKE '%Cuponidad%' 
        AND dc.uuid NOT LIKE '%CUPON%' 
        AND dc.uuid != '1234567890'
        AND dc.uuid NOT LIKE '%GRATIS%'
      LIMIT 10
    `);
    console.log('Real DescuentoCliente:', res.rows);
    
    const res2 = await pool.query(`
      SELECT dmc.uuid, d.nombre
      FROM descuentomasivocliente dmc
      JOIN descuentodetalle dd ON dd.id = dmc.descuentodetalle_id
      JOIN descuento d ON d.id = dd.descuento_id
      WHERE d.nombre ILIKE '%Cuponidad%'
        AND dmc.uuid NOT LIKE '%CUPON%'
      LIMIT 10
    `);
    console.log('Real MasivoCliente:', res2.rows);
  } catch (e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
}
test();
