const pool = require('./config/database');
async function run() {
  try {
    const res = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public'");
    const tables = res.rows.map(r=>r.table_name);
    console.log(tables.filter(n=> n.includes('pago') || n.includes('comprobante') || n.includes('propietario') || n.includes('cliente') || n.includes('soat')));
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}
run();
