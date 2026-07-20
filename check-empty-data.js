const db = require('./config/database');
async function run() {
   try {
     const q = `SELECT count(*) as count FROM resultado_maquina WHERE data = '' OR postdata = '' OR data IS NULL`;
     const res = await db.query(q);
     console.log('Bad data rows:', res.rows[0].count);
   } catch(e) { console.error(e); }
   process.exit(0);
}
run();
