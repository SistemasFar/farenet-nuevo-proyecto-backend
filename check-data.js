const db = require('./config/database');
async function run() {
   const q = `SELECT count(*) as total, sum(case when data is not null then 1 else 0 end) as with_data FROM resultado_maquina`;
   const res = await db.query(q);
   console.log(res.rows[0]);
   process.exit(0);
}
run();
