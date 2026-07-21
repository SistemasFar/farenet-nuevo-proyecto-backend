const db = require('./config/database');
async function run() {
   const q = `SELECT * FROM certificado WHERE inspeccion_nrodocumentoinspeccion = 'INS-201-000157904'`;
   const res = await db.query(q);
   console.log('certificado:', res.rows);
   process.exit(0);
}
run();
