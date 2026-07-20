const db = require('./config/database');
async function run() {
   const q = `SELECT count(*) FROM resultado_maquina WHERE data LIKE '%mapaNormas%'`;
   const res = await db.query(q);
   console.log('Total mapaNormas:', res.rows[0].count);
   process.exit(0);
}
run();
