const db = require('./config/database');
async function run() {
   const nroInspeccion = 'INS-201-000158204';
   const q = `SELECT m.tipomaquina_key, rm.data, rm.postdata FROM resultado_maquina rm JOIN maquina m ON rm.maquina_id = m.id WHERE rm.inspeccion_nrodocumentoinspeccion = $1`;
   const res = await db.query(q, [nroInspeccion]);
   console.log('Total de resultados para ' + nroInspeccion + ':', res.rowCount);
   res.rows.forEach(r => {
      console.log('tipomaquina_key:', r.tipomaquina_key);
      if (r.tipomaquina_key === '3' || r.tipomaquina_key == 3) {
         console.log('DATA FRENOS:', r.data);
      }
   });
   process.exit(0);
}
run();
