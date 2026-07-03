const pool = require('./config/database');
async function run() {
  const query = `
    UPDATE inspeccion 
    SET tipoautorizacion_key = '6', 
        tipocertificado_key = '2', 
        tipoinspeccion_key = '3' 
    WHERE nrodocumentoinspeccion = 'INS-TEST2-1001'
  `;
  const res = await pool.query(query);
  console.log(`Updated ${res.rowCount} row(s)`);
  process.exit(0);
}
run();
