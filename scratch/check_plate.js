const db = require('../config/database');
async function run() {
  const vRes = await db.query("SELECT nroplacaantigua, nromotor FROM vehiculo WHERE nroplacaantigua IS NOT NULL AND nromotor IS NOT NULL LIMIT 1");
  console.log(vRes.rows[0]);
  process.exit(0);
}
run();
