const db = require('./config/database');
async function run() {
   const q = `
      SELECT rm.id, rm.data, rm.postdata, m.tipomaquina_key 
      FROM resultado_maquina rm 
      JOIN maquina m ON rm.maquina_id = m.id 
      WHERE rm.inspeccion_nrodocumentoinspeccion LIKE 'INS-201-000157904%'
      AND m.tipomaquina_key = '3'
   `;
   const res = await db.query(q);
   console.log(JSON.stringify(res.rows[0], null, 2));
   process.exit(0);
}
run();
