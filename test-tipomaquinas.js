const db = require('./config/database');
async function run() {
   const q = `SELECT m.tipomaquina_key FROM resultado_maquina rm JOIN maquina m ON rm.maquina_id = m.id WHERE rm.inspeccion_nrodocumentoinspeccion = 'INS-100-000123739MM'`;
   const res = await db.query(q);
   console.log(res.rows.map(r => r.tipomaquina_key));
   process.exit(0);
}
run();
