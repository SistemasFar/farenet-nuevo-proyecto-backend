const pool = require('./config/database');

async function run() {
  const result = await pool.query('SELECT * FROM periodoreinspeccion ORDER BY dias ASC');
  console.log(result.rows);
  process.exit(0);
}
run();
