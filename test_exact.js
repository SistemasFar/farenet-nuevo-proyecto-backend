const db = require('./config/database');
async function test() {
  try {
    const { rows } = await db.query(`SELECT id FROM resultado_maquina WHERE inspeccion_nrodocumentoinspeccion = 'INS-201-000158749'`);
    console.log("Filas EXACT 749:", rows.length);
    const r2 = await db.query(`SELECT id FROM resultado_maquina WHERE inspeccion_nrodocumentoinspeccion = 'INS-201-000158748'`);
    console.log("Filas EXACT 748:", r2.rows.length);
    
    // Y probamos con LIKE %
    const r3 = await db.query(`SELECT id, inspeccion_nrodocumentoinspeccion FROM resultado_maquina WHERE inspeccion_nrodocumentoinspeccion LIKE 'INS-201-000158748%'`);
    console.log("Filas LIKE 748:", r3.rows.length);
    if(r3.rows.length > 0) console.log("Reales:", [...new Set(r3.rows.map(r=>r.inspeccion_nrodocumentoinspeccion))]);
  } catch (e) {
    console.error(e.message);
  } finally {
    process.exit(0);
  }
}
test();
