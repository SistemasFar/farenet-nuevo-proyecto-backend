const pool = require('./config/database');

async function run() {
  const res = await pool.query("SELECT nrodocumentoinspeccion, inspeccionestado_key, posicion, fechaenlinea, fechcreacion, fechmodi FROM inspeccion WHERE nrodocumentoinspeccion = 'INS-201-000160204'");
  console.log(res.rows);
  process.exit(0);
}

run().catch(console.error);
