const pool = require('./config/database');

async function run() {
  const result = await pool.query(`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = 'comprobante'
  `);
  console.log(result.rows);
  process.exit(0);
}
run();
