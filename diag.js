const db = require('./config/database');
const fs = require('fs');

async function run() {
  try {
    const q1 = `
      SELECT id, descripcion, tipomaquina_key, 
             LENGTH(tipomaquina_key) as len, LENGTH(TRIM(tipomaquina_key)) as len_trim
      FROM maquina
      WHERE LENGTH(tipomaquina_key) != LENGTH(TRIM(tipomaquina_key))
      LIMIT 5
    `;
    const res1 = await db.query(q1);
    console.log('--- MAQUINA SPACES ---');
    if (res1.rows.length === 0) console.log('NO SPACES FOUND IN tipomaquina_key');
    else console.table(res1.rows);

    // Get real inspection data
    const q3 = `
      SELECT rm.id, m.tipomaquina_key, rm.data, rm.postdata
      FROM resultado_maquina rm
      JOIN maquina m ON rm.maquina_id = m.id
      WHERE rm.data IS NOT NULL
      ORDER BY rm.id DESC
      LIMIT 10
    `;
    const res3 = await db.query(q3);
    console.log('--- REAL INSPECTION DATA ---');
    for (let r of res3.rows) {
      console.log('ID:', r.id, '| Tipo:', r.tipomaquina_key);
      console.log('Data Keys:', typeof r.data === 'string' ? Object.keys(JSON.parse(r.data)) : Object.keys(r.data));
    }
    
  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}
run();
