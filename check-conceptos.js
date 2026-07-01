const pool = require('./config/database');
async function run() {
  try {
    const res = await pool.query('SELECT key, abreviatura, nombre FROM conceptoinspeccion LIMIT 5');
    console.log(res.rows);
  } catch(e) { console.error(e); } finally { process.exit(0); }
}
run();
