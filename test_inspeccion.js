const db = require('./config/database');
async function test() {
  try {
    const r = await db.query(`SELECT nrodocumentoinspeccion FROM inspeccion WHERE nrodocumentoinspeccion LIKE 'INS-201-000158748%'`);
    console.log('Inspecciones:', r.rows);
  } catch (e) {
    console.error(e.message);
  } finally {
    process.exit(0);
  }
}
test();
