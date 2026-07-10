const pool = require('./config/database');
async function run() {
  const r1 = await pool.query("SELECT nrodocumentoinspeccion, posicion, resultado, inspeccionestado_key, fechconsolidado FROM inspeccion WHERE nrodocumentoinspeccion = 'INS-98-000630100'");
  console.log('Inspeccion:', r1.rows[0]);
  
  const r2 = await pool.query("SELECT rm.inspeccion_nrodocumentoinspeccion, rm.maquina_id, COUNT(*) AS cantidad FROM resultado_maquina rm WHERE rm.inspeccion_nrodocumentoinspeccion = 'INS-98-000630100' GROUP BY rm.inspeccion_nrodocumentoinspeccion, rm.maquina_id HAVING COUNT(*) > 1");
  console.log('Duplicados:', r2.rows);
  
  process.exit(0);
}
run();
