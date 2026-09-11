const db = require('../../../config/database');
async function run() {
  const res = await db.query('SELECT * FROM fg_certificado_formato ORDER BY id');
  console.log(res.rows);
  const res2 = await db.query('SELECT * FROM fg_certificado_formato_version');
  console.log(res2.rows);
  process.exit();
}
run();
