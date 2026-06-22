const pool = require('./config/database');
async function run() {
  try {
    const v = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'vehiculo' AND is_nullable = 'NO'");
    console.log('NOT NULL COLUMNS:', v.rows);
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}
run();
