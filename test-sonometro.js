const db = require('./config/database');
async function run() {
   const q = `SELECT rm.data, rm.postdata, rm.resultado FROM resultado_maquina rm JOIN maquina m ON rm.maquina_id = m.id WHERE rm.inspeccion_nrodocumentoinspeccion LIKE 'INS-201-000158204%' AND m.tipomaquina_key = '6'`;
   const res = await db.query(q);
   console.log(JSON.stringify(res.rows, null, 2));
   process.exit(0);
}
run();
