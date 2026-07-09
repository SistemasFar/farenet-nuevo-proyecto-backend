const pool = require('./config/database'); 
async function test() { 
  try { 
    await pool.query("ALTER TABLE vehiculo DROP COLUMN tipoplaca_key"); 
    console.log('Column dropped successfully'); 
    process.exit(0); 
  } catch (e) { 
    console.error('Error:', e.message); 
    process.exit(1); 
  } 
}; 
test();
