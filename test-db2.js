const pool = require('./config/database');

async function run() {
  try {
    const res = await pool.query(`
      SELECT fechinicio, fechfin, estado FROM descuento WHERE id = '17926942'
    `);
    console.log(res.rows);
  } catch(e) { 
    console.error(e); 
  } finally { 
    process.exit(0); 
  }
}

run();
