const pool = require('./config/database');
async function run() {
  try {
    const q = await pool.query("SELECT column_default, data_type FROM information_schema.columns WHERE table_name = 'pago' AND column_name = 'id'");
    console.log(q.rows);
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}
run();
