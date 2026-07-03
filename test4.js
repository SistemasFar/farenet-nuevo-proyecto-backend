const pool = require('./config/database');
async function run() {
  const res = await pool.query("SELECT data_type FROM information_schema.columns WHERE table_name = 'marca' AND column_name = 'key'");
  console.log(res.rows);
  process.exit(0);
}
run();
