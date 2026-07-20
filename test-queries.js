const db = require('./config/database');
async function run() {
   try {
      const q = `
      SELECT d.codigovalor, d.nombrevalor, d.nivelpeligro 
      FROM resultado_maquina rm 
      JOIN resultado_maquina_defecto rmd ON rmd.resultado_maquina_id = rm.id 
      JOIN defecto d ON d.id = rmd.defectos_id 
      WHERE rm.inspeccion_nrodocumentoinspeccion = 'INS-100-000123739MM'
      `;
      await db.query(q);
      console.log('Query 1 OK');
   } catch(e) { console.error('Query 1 FAILED:', e.message); }

   try {
      const ids = [1];
      const qNormas = `SELECT id, codigovalor, nombrevalor FROM norma WHERE id = ANY($1::bigint[])`;
      await db.query(qNormas, [ids]);
      console.log('Query 2 OK');
   } catch(e) { console.error('Query 2 FAILED:', e.message); }
   
   process.exit(0);
}
run();
