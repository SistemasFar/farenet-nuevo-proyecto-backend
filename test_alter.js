const pool = require('./config/database'); 
async function test() { 
  try { 
    await pool.query("ALTER TABLE vehiculo ADD COLUMN tipoplaca_key bigint"); 
    console.log('Column added successfully'); 
    process.exit(0); 
  } catch (e) { 
    console.error('Error:', e.message); 
    process.exit(1); 
  } 
}; 
test();
