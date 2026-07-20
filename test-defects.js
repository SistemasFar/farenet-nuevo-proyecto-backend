const db = require('./config/database');
async function run() {
  try {
    const q = `
      SELECT d.codigovalor, d.nombrevalor 
      FROM resultado_maquina rm 
      JOIN resultado_maquina_defecto rmd ON rmd.resultado_maquina_id = rm.id 
      JOIN defecto d ON d.id = rmd.defectos_id 
      WHERE rm.inspeccion_nrodocumentoinspeccion = 'INS-100-000123739MM'
    `;
    const res = await db.query(q);
    console.log('Defectos:', res.rows);
  } catch(e) { console.error(e); }
  finally { process.exit(0); }
}
run();
