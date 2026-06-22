const pool = require('./config/database');
async function run() {
  try {
    const q1 = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'pago'");
    const q2 = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'persona'");
    const q3 = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'empresa'");
    console.log("PAGO COLS:", q1.rows.map(r=>r.column_name));
    console.log("PERSONA COLS:", q2.rows.map(r=>r.column_name));
    console.log("EMPRESA COLS:", q3.rows.map(r=>r.column_name));
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}
run();
