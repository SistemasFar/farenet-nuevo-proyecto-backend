const pool = require('./config/database');
async function run() {
  try {
    const q = await pool.query("SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name = 'pago'");
    console.log(q.rows.filter(r => r.is_nullable === 'NO'));
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}
run();
