const pool = require('./config/database'); 
async function test() { 
  try { 
    const res = await pool.query("SELECT * FROM tipoplaca LIMIT 5"); 
    console.log(res.rows); 
    process.exit(0); 
  } catch (e) { 
    console.error(e); 
    process.exit(1); 
  } 
}; 
test();
