const pool = require('./config/database'); 
async function test() { 
  try { 
    const res = await pool.query("SELECT table_name, column_name FROM information_schema.columns WHERE column_name LIKE '%placa%'"); 
    console.log(res.rows); 
    process.exit(0); 
  } catch (e) { 
    console.error(e); 
    process.exit(1); 
  } 
}; 
test();
