const pool = require('./config/database');

async function main() {
  const comp = await pool.query(`SELECT * FROM comprobante LIMIT 1`);
  console.log(Object.keys(comp.rows[0]));
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
