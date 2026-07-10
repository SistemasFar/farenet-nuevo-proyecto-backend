const pool = require('./config/database');
async function run() {
  const r1 = await pool.query("SELECT nrodocumentoinspeccion, posicion, resultado, inspeccionestado_key, fechconsolidado FROM inspeccion WHERE posicion = 5 AND inspeccionestado_key != 'CON' AND fechconsolidado IS NULL LIMIT 1");
  console.log('Inspeccion:', r1.rows);
  process.exit(0);
}
run();
