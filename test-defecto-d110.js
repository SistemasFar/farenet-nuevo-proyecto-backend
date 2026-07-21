const db = require('./config/database');
async function run() {
   const q = `SELECT codigovalor, nombrevalor, nivelpeligro FROM defecto WHERE codigovalor = 'D.1.10'`;
   const res = await db.query(q);
   console.log(res.rows);
   process.exit(0);
}
run();
