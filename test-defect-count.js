const db = require('./config/database');
async function run() {
   const q = `SELECT count(*) FROM resultado_maquina_defecto`;
   const res = await db.query(q);
   console.log('Total defectos:', res.rows[0].count);
   process.exit(0);
}
run();
