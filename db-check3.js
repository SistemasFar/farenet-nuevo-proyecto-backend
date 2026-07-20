const db = require('./config/database');
async function run() {
  try {
    const q3 = `
      SELECT data
      FROM resultado_maquina 
      WHERE data::text LIKE '%mapaNormas%'
      ORDER BY id DESC
      LIMIT 100;
    `;
    const res3 = await db.query(q3);
    for (const row of res3.rows) {
       let dataObj = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
       if (dataObj && dataObj.mapaNormas && Object.keys(dataObj.mapaNormas).length > 0) {
           console.log('--- ESTRUCTURA mapaNormas CON DATOS ---');
           console.log(dataObj.mapaNormas);
           process.exit(0);
       }
    }
    console.log('No mapaNormas with data found in the last 100 records');
  } catch (e) { console.error(e); } finally { process.exit(0); }
}
run();
