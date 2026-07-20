const db = require('./config/database');
async function run() {
   const q = `SELECT rm.inspeccion_nrodocumentoinspeccion, rm.data FROM resultado_maquina rm JOIN maquina m ON rm.maquina_id = m.id WHERE m.tipomaquina_key = '3' ORDER BY rm.id DESC LIMIT 5`;
   const res = await db.query(q);
   console.log(JSON.stringify(res.rows, null, 2));
   process.exit(0);
}
run();
