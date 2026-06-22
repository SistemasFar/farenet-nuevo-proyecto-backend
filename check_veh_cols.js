const pool = require('./config/database');
async function run() {
  try {
    const q = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'vehiculo'");
    console.log(q.rows.map(r=>r.column_name).join(', '));
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}
run();
