const pool = require('./config/database');
async function run() {
  try {
    const q = await pool.query("SELECT * FROM pago ORDER BY fechacreacion DESC LIMIT 5");
    console.log(q.rows);
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}
run();
