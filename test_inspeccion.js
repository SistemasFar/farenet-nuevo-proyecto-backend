const pool = require('./config/database'); 
async function test() { 
  try { 
    const res = await pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'inspeccion'"); 
    console.log(res.rows.map(r => r.column_name).join(', ')); 
    process.exit(0); 
  } catch (e) { 
    console.error(e); 
    process.exit(1); 
  } 
}; 
test();
