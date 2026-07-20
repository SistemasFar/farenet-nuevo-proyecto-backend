const db = require('./config/database');
async function run() {
  try {
    const q3 = `
      SELECT data
      FROM resultado_maquina 
      WHERE data::text LIKE '%mapaNormas%'
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
