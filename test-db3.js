const pool = require('./config/database');

async function run() {
  try {
    const res = await pool.query(`UPDATE descuento SET fechfin = '2026-12-31' WHERE id = '17926942'`);
    console.log("Updated", res.rowCount);
  } catch(e) { 
    console.error(e); 
  } finally { 
    process.exit(0); 
  }
}

run();
