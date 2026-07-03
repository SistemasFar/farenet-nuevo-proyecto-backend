const pool = require('./config/database');
async function test() {
  try {
    const res = await pool.query("SELECT d.id, d.nombre, dc.uuid FROM descuento d JOIN descuentodetalle dd ON d.id = dd.descuento_id JOIN descuentocliente dc ON dd.id = dc.descuentodetalle_id WHERE d.nombre ILIKE '%Cuponidad%' LIMIT 5");
    console.log('DescuentoCliente:', res.rows);
    const res2 = await pool.query("SELECT d.id, d.nombre, dmc.uuid FROM descuento d JOIN descuentodetalle dd ON d.id = dd.descuento_id JOIN descuentomasivocliente dmc ON dd.id = dmc.descuentodetalle_id WHERE d.nombre ILIKE '%Cuponidad%' LIMIT 5");
    console.log('MasivoCliente:', res2.rows);
  } catch (e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
}
test();
