const pool = require('./config/database');

async function checkDB() {
  try {
    const res = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'");
    console.log("Tablas en la BD:");
    console.log(res.rows.map(r => r.table_name));

    const vehiculos = await pool.query("SELECT COUNT(*) FROM vehiculo");
    console.log("Total vehiculos:", vehiculos.rows[0].count);

    const inspecciones = await pool.query("SELECT COUNT(*) FROM inspeccion");
    console.log("Total inspecciones:", inspecciones.rows[0].count);

  } catch (err) {
    console.error(err);
  } finally {
    pool.end();
  }
}

checkDB();
