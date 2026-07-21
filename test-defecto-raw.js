const db = require('./config/database');
async function run() {
   const q = `SELECT * FROM resultado_maquina_defecto WHERE resultado_maquina_id IN (SELECT id FROM resultado_maquina WHERE inspeccion_nrodocumentoinspeccion = 'INS-201-000157904')`;
   const res = await db.query(q);
   console.log('resultado_maquina_defecto rows:', res.rows);
   process.exit(0);
}
run();
