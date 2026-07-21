const db = require('./config/database');
async function run() {
   console.log('\n--- CHECKING RESULTADO_MAQUINA FOR DEFECTOS ---');
   const q2 = `
      SELECT rm.id, rm.data, m.tipomaquina_key 
      FROM resultado_maquina rm 
      JOIN maquina m ON rm.maquina_id = m.id 
      WHERE rm.inspeccion_nrodocumentoinspeccion LIKE 'INS-201-000157904%'
   `;
   const res2 = await db.query(q2);
   for (let row of res2.rows) {
       console.log(`Maquina ${row.tipomaquina_key} data:`, row.data ? JSON.stringify(row.data).substring(0, 200) : 'null');
   }
   
   console.log('\n--- CHECKING DEFECTOS DIRECTOS ---');
   const q3 = `
      SELECT d.codigovalor, d.nombrevalor, d.nivelpeligro 
      FROM resultado_maquina rm 
      JOIN resultado_maquina_defecto rmd ON rmd.resultado_maquina_id = rm.id 
      JOIN defecto d ON d.id = rmd.defectos_id 
      WHERE rm.inspeccion_nrodocumentoinspeccion LIKE 'INS-201-000157904%'
   `;
   const res3 = await db.query(q3);
   console.log(res3.rows);

   process.exit(0);
}
run();
