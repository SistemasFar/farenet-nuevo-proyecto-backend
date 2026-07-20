const db = require('./config/database');
async function run() {
   const q = `SELECT rm.inspeccion_nrodocumentoinspeccion, m.tipomaquina_key FROM resultado_maquina rm JOIN maquina m ON rm.maquina_id = m.id WHERE rm.inspeccion_nrodocumentoinspeccion LIKE '%158204%'`;
   const res = await db.query(q);
   console.log('Resultados LIKE %158204%:', res.rowCount);
   if (res.rowCount > 0) {
      console.log(res.rows);
   }
   process.exit(0);
}
run();
