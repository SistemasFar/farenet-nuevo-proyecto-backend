const db = require('./config/database');
async function run() {
   const q = `SELECT * FROM inspeccion_defecto WHERE inspeccion_nrodocumentoinspeccion = 'INS-201-000157904'`;
   try {
       const res = await db.query(q);
       console.log('inspeccion_defecto:', res.rows);
   } catch(e) {
       console.log('Table inspeccion_defecto may not exist or error:', e.message);
   }
   process.exit(0);
}
run();
