const pool = require('./config/database');
async function run() {
  try {
    const res = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name IN ('vehiculo', 'inspeccion', 'comprobante')");
    console.log(res.rows.map(r => r.column_name).filter(c => c.toLowerCase().includes('placa')));
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}
run();
