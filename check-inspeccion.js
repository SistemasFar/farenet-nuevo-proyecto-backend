const db = require('./config/database');
async function run() {
   const q = `SELECT nrodocumentoinspeccion FROM inspeccion WHERE nrodocumentoinspeccion = 'INS-100-000123739MM'`;
   const res = await db.query(q);
   console.log('Exists in inspeccion:', res.rows.length);
   process.exit(0);
}
run();
