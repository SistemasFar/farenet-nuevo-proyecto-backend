const pool = require('./config/database');

async function check() {
  const c = await pool.connect();
  try {
    const etapas = await c.query("SELECT * FROM etapa");
    console.log("Tabla etapa:");
    console.table(etapas.rows);
  } catch (e) {
    console.error("No hay tabla etapa", e.message);
  } finally {
    c.release();
    process.exit(0);
  }
}
check();
