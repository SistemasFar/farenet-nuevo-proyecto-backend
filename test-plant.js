const db = require('./config/database');
async function run() {
   const q = `SELECT c.linea_key, l.planta_key FROM comprobante c JOIN linea l ON c.linea_key = l.key WHERE c.inspeccion_nrodocumentoinspeccion = 'INS-100-000123739MM'`;
   const res = await db.query(q);
   console.log('Planta:', res.rows[0]);
   process.exit(0);
}
run();
