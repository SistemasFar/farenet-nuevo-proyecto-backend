const pool = require('./config/database'); 
async function test() { 
  try { 
    const res = await pool.query(`
      SELECT tc.table_name, kcu.column_name 
      FROM information_schema.table_constraints AS tc 
      JOIN information_schema.key_column_usage AS kcu 
        ON tc.constraint_name = kcu.constraint_name 
      JOIN information_schema.constraint_column_usage AS ccu 
        ON ccu.constraint_name = tc.constraint_name 
      WHERE constraint_type = 'FOREIGN KEY' AND ccu.table_name='tipoplaca'
    `); 
    console.log("FOREIGN KEYS:", res.rows); 
    
    // Also check if any column contains 'tipoplaca' in ANY table
    const res2 = await pool.query(`
      SELECT table_name, column_name 
      FROM information_schema.columns 
      WHERE column_name LIKE '%tipoplaca%'
    `);
    console.log("COLUMNS LIKE TIPOPLACA:", res2.rows);

    process.exit(0); 
  } catch (e) { 
    console.error(e); 
    process.exit(1); 
  } 
}; 
test();
