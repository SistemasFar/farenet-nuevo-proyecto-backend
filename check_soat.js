const pool = require('./config/database');
async function run() {
  try {
    const q = await pool.query("SELECT table_name, column_name FROM information_schema.columns WHERE column_name LIKE '%soat%'");
    console.log(q.rows);
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}
run();
