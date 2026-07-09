const pool = require('./config/database');

async function check() {
  const c = await pool.connect();
  try {
    const res = await c.query("SELECT * FROM tipoinspeccion");
    console.table(res.rows);
  } catch (e) {
    console.error(e);
  } finally {
    c.release();
    process.exit(0);
  }
}
check();
