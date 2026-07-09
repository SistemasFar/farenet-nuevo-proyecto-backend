const pool = require('./config/database');

async function check() {
  const c = await pool.connect();
  try {
    const colRes = await c.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'linea_etapa'");
    console.log("Columnas de linea_etapa:", colRes.rows);

    const dataRes = await c.query("SELECT * FROM linea_etapa LIMIT 20");
    console.log("Datos de linea_etapa:");
    console.table(dataRes.rows);
  } catch (e) {
    console.error(e);
  } finally {
    c.release();
    process.exit(0);
  }
}
check();
