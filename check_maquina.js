const pool = require('./config/database');

async function run() {
  try {
    const res = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'maquina'
    `);
    console.log(res.rows);
  } catch (err) {
    console.log(err);
  }
  process.exit(0);
}
run();
