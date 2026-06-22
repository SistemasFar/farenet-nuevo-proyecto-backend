const pool = require('./config/database');
async function run() {
  try {
    const q = await pool.query("SELECT * FROM comprobante ORDER BY fechcreacion DESC LIMIT 5");
    console.log(q.rows.map(r=>({id: r.id, insp: r.inspeccion_nrodocumentoinspeccion, date: r.fechcreacion})));
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}
run();
