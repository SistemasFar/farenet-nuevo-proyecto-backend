const db = require('./config/database');

async function run() {
  try {
    const q1 = `
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'resultado_maquina_defecto';
    `;
    const res1 = await db.query(q1);
    console.log('--- COLUMNAS resultado_maquina_defecto ---');
    console.table(res1.rows);
    
    const q2 = `
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'defecto';
    `;
    const res2 = await db.query(q2);
    console.log('--- COLUMNAS defecto ---');
    console.table(res2.rows);

    const q3 = `
      SELECT data
      FROM resultado_maquina 
      WHERE data LIKE '%mapaNormas%'
      LIMIT 1;
    `;
    const res3 = await db.query(q3);
    console.log('--- ESTRUCTURA mapaNormas ---');
    if (res3.rows.length > 0) {
       console.log(typeof res3.rows[0].data === 'string' ? JSON.parse(res3.rows[0].data).mapaNormas : res3.rows[0].data.mapaNormas);
    } else {
       console.log('No mapaNormas found');
    }
  } catch (e) { console.error(e); } finally { process.exit(0); }
}
run();
