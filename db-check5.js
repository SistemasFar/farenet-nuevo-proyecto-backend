const db = require('./config/database');
async function run() {
  try {
    const q1 = `SELECT * FROM norma WHERE codigovalor = '170' OR id = 170`;
    const res = await db.query(q1);
    console.table(res.rows);
  } catch(e){} finally { process.exit(0); }
}
run();
