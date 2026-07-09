const pool = require('./config/database');

async function check() {
  const c = await pool.connect();
  try {
    // Buscar tablas relacionadas con pruebas, conceptos y estaciones
    const res = await c.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND (table_name LIKE '%concepto%' OR table_name LIKE '%prueba%' OR table_name LIKE '%estacion%' OR table_name LIKE '%linea%') ORDER BY table_name");
    console.log("Tablas encontradas:", res.rows.map(r => r.table_name));

    // Si existe conceptoinspecciondetalle, ver sus columnas
    const colRes = await c.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'conceptoinspecciondetalle'");
    console.log("Columnas de conceptoinspecciondetalle:", colRes.rows);

  } catch (e) {
    console.error(e);
  } finally {
    c.release();
    process.exit(0);
  }
}
check();
