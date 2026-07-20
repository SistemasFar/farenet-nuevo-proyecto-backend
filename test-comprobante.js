const db = require('./config/database');
async function run() {
   const res = await db.query(`SELECT inspeccion_nrodocumentoinspeccion FROM comprobante WHERE inspeccion_nrodocumentoinspeccion LIKE 'INS-201-000158204%'`);
   console.log('comprobante:', res.rows);
   process.exit(0);
}
run();
