const db = require('./config/database');
async function run() {
   const q = `
      SELECT rm.id, rm.data, rm.postdata, m.tipomaquina_key 
      FROM resultado_maquina rm 
      JOIN maquina m ON rm.maquina_id = m.id 
      WHERE rm.inspeccion_nrodocumentoinspeccion LIKE 'INS-201-000157904%'
   `;
   const res = await db.query(q);
   for (let row of res.rows) {
       for (let field of ['data', 'postdata']) {
           if (row[field]) {
               let d = row[field];
               if (typeof d === 'string') {
                   try { d = JSON.parse(d); } catch(e) {}
               }
               if (d.mapaNormas && Object.keys(d.mapaNormas).length > 0) {
                   console.log(`Maquina ${row.tipomaquina_key} [${field}] mapaNormas:`, d.mapaNormas);
               }
               if (d.observacion) {
                   console.log(`Maquina ${row.tipomaquina_key} [${field}] observacion:`, d.observacion);
               }
               if (d.observaciones) {
                   console.log(`Maquina ${row.tipomaquina_key} [${field}] observaciones:`, d.observaciones);
               }
           }
       }
   }
   process.exit(0);
}
run();
