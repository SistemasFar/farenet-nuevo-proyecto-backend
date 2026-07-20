const db = require('./config/database');
async function run() {
   const q = `SELECT * FROM resultado_maquina WHERE inspeccion_nrodocumentoinspeccion LIKE '%123739%'`;
   const res = await db.query(q);
   console.log('Filas encontradas:', res.rows.length);
   process.exit(0);
}
run();
