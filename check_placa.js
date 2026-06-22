const pool = require('./config/database');
async function run() {
  try {
    const q1 = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'inspeccion' AND column_name LIKE '%placa%'");
    console.log("PLACA IN inspeccion:", q1.rows);
    const q2 = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'comprobante' AND column_name LIKE '%placa%'");
    console.log("PLACA IN comprobante:", q2.rows);
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}
run();
