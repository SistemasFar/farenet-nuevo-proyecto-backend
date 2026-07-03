const pool = require('./config/database');
async function test() {
  try {
    const resColumns = await pool.query("SELECT table_name, column_name FROM information_schema.columns WHERE column_name ILIKE '%cuponidad%'");
    console.log('Columnas con cuponidad:', resColumns.rows);
    
    const resTables = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_name ILIKE '%cuponidad%'");
    console.log('Tablas con cuponidad:', resTables.rows);
  } catch (e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
}
test();
