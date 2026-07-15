const db = require('./config/database');
async function test() {
  try {
    const seq = await db.query(`SELECT nextval('hibernate_sequence') as id`);
    console.log("Sequence:", seq.rows[0]);
  } catch (e) {
    console.error("Sequence Error:", e.message);
  } finally {
    process.exit(0);
  }
}
test();
