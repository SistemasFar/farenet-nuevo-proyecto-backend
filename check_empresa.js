const pool = require('./config/database');

async function check() {
  try {
    const res = await pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'empresa'");
    console.log('Columnas de empresa:', res.rows);
  } finally {
    await pool.end();
  }
}
check();
