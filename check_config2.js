const pool = require('./config/database');

async function check() {
  const c = await pool.connect();
  try {
    const data1 = await c.query("SELECT * FROM conceptoinspecciondetalle LIMIT 20");
    console.log("conceptoinspecciondetalle:");
    console.table(data1.rows);

    const tables = await c.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE '%prueba%'");
    console.log("Tablas relacionadas a prueba:", tables.rows.map(r => r.table_name));
    
    // Let's also check if there is a 'prueba' table
    const colsPrueba = await c.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'prueba'");
    if (colsPrueba.rows.length > 0) {
      console.log("Columnas de prueba:", colsPrueba.rows);
      const dataPrueba = await c.query("SELECT * FROM prueba LIMIT 20");
      console.table(dataPrueba.rows);
    }

  } catch (e) {
    console.error(e);
  } finally {
    c.release();
    process.exit(0);
  }
}
check();
