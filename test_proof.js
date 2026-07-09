const pool = require('./config/database'); 
async function test() { 
  try { 
    console.log("--- 1. VERIFICAR COLUMNA TIPOPLACA_KEY EN VEHICULO ---");
    const res1 = await pool.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'vehiculo'
        AND column_name = 'tipoplaca_key'
    `);
    console.log("Resultado:", res1.rows);

    console.log("\n--- 2. VERIFICAR TODAS LAS COLUMNAS DE VEHICULO ---");
    const res2 = await pool.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'vehiculo'
      ORDER BY ordinal_position
    `);
    console.log("Columnas de vehiculo:", res2.rows.map(r => r.column_name).join(', '));

    console.log("\n--- 3. VERIFICAR EXISTENCIA DE UI_METADATA O FORM_DATA ---");
    const res3 = await pool.query(`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE column_name IN ('ui_metadata', 'form_data')
    `);
    console.log("Resultado:", res3.rows);

    process.exit(0); 
  } catch (e) { 
    console.error('Error:', e.message); 
    process.exit(1); 
  } 
}; 
test();
