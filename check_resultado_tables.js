const pool = require('./config/database');

async function run() {
  try {
    const res = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name LIKE '%resultado%'
    `);
    console.log(res.rows);
  } catch (err) {
    console.log(err);
  }
  process.exit(0);
}
run();
