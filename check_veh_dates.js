const pool = require('./config/database');
async function run() {
  try {
    const q = await pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'vehiculo' AND data_type LIKE '%time%'");
    console.log("TIMESTAMP COLUMNS in vehiculo:");
    console.log(q.rows);
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}
run();
