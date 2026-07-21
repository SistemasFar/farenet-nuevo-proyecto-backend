const db = require('./config/database');
async function run() {
   const q = `SELECT observacion FROM inspeccion WHERE nrodocumentoinspeccion = 'INS-201-000157904'`;
   const res = await db.query(q);
   console.log('inspeccion.observacion =', res.rows[0]?.observacion);
   process.exit(0);
}
run();
