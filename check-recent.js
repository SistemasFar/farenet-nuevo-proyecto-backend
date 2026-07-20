const db = require('./config/database');
async function run() {
   const q = `SELECT inspeccion_nrodocumentoinspeccion, data FROM resultado_maquina ORDER BY id DESC LIMIT 20`;
   const res = await db.query(q);
   res.rows.forEach((r, i) => console.log(i, r.inspeccion_nrodocumentoinspeccion, 'data is null:', r.data === null));
   process.exit(0);
}
run();
