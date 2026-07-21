const db = require('./config/database');
async function run() {
   const q = `
      SELECT * 
      FROM resultado_maquina rm 
      JOIN resultado_maquina_defectos rmd ON rmd.resultado_maquina_id = rm.id 
      WHERE rm.inspeccion_nrodocumentoinspeccion LIKE 'INS-201-000157904%'
   `;
   try {
       const res = await db.query(q);
       console.log('resultado_maquina_defectos:', res.rows);
   } catch(e) {
       console.log('Error:', e.message);
   }
   process.exit(0);
}
run();
