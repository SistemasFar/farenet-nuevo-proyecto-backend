const pool = require('./config/database');

async function check() {
  const c = await pool.connect();
  try {
    const res = await c.query("SELECT proname FROM pg_proc WHERE pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public') AND proname LIKE '%posicion%'");
    console.log("Funciones que contengan 'posicion':", res.rows);
    
    const res2 = await c.query("SELECT proname FROM pg_proc WHERE pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public') AND proname LIKE '%linea%'");
    console.log("Funciones que contengan 'linea':", res2.rows);

  } catch (e) {
    console.error(e);
  } finally {
    c.release();
    process.exit(0);
  }
}
check();
