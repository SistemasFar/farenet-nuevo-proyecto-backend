const pool = require('./config/database');
async function test() {
  try {
    const res = await pool.query("SELECT * FROM descuento WHERE nombre ILIKE '%Cuponidad%'");
    console.log('Descuentos originales:', res.rows);
  } catch (e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
}
test();
