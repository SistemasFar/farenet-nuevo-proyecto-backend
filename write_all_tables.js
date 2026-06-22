const pool = require('./config/database');
async function run() {
  try {
    const res = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name");
    const fs = require('fs');
    fs.writeFileSync('all_tables.txt', res.rows.map(r=>r.table_name).join('\n'));
    console.log("Wrote tables to all_tables.txt");
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}
run();
