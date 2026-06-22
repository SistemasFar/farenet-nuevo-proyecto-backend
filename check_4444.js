const pool = require('./config/database');
async function run() {
  try {
    const v = await pool.query("SELECT nromotor, categoria_key, nroplacaantigua, fechcreacion, fechmodi FROM vehiculo WHERE nroplacaantigua = '4444'");
    console.log(v.rows);
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}
run();
