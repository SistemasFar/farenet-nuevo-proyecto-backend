const pool = require('./config/database'); 
async function test() { 
  try { 
    const res1 = await pool.query("SELECT nrodocumentoinspeccion, inspeccionestado_key, posicion, estado, fechcreacion, fechmodi FROM inspeccion WHERE nrodocumentoinspeccion = 'INS-201-000160118'"); 
    console.log('=== QUERY 1 ===\n', res1.rows); 
    const res2 = await pool.query("SELECT nrodocumentoinspeccion, inspeccionestado_key, posicion, estado, fechcreacion, fechmodi FROM inspeccion WHERE nrodocumentoinspeccion LIKE 'INS-201-%' ORDER BY nrodocumentoinspeccion DESC LIMIT 30"); 
    console.log('=== QUERY 2 ===\n', res2.rows); 
    const res3 = await pool.query("SELECT * FROM seriedocumentobase WHERE planta_key = '201'"); 
    console.log('=== SERIE ===\n', res3.rows); 
    process.exit(0); 
  } catch (e) { 
    console.error(e); 
    process.exit(1); 
  } 
}; 
test();
