const db = require('./config/database');
async function run() {
   const q = `SELECT * FROM norma WHERE id IN (370, 365, 369)`;
   const res = await db.query(q);
   console.log(JSON.stringify(res.rows, null, 2));
   process.exit(0);
}
run();
