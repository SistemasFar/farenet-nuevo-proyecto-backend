const pool = require('./config/database');
async function run() {
  try {
    const res = await pool.query("SELECT nromotor, nroplacaantigua, categoria_key FROM vehiculo LIMIT 10");
    console.log(res.rows);
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}
run();
