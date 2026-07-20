const db = require('./config/database');
async function run() {
   const q = `SELECT nrodocumentoinspeccion FROM inspeccion WHERE nrodocumentoinspeccion LIKE '%158204%'`;
   const res = await db.query(q);
   console.log('inspeccion:', res.rows);
   process.exit(0);
}
run();
