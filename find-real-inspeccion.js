const db = require('./config/database');
async function run() {
  try {
    const q = `
      SELECT rm.inspeccion_nrodocumentoinspeccion, rm.data 
      FROM resultado_maquina rm
      JOIN maquina m ON rm.maquina_id = m.id
      WHERE m.tipomaquina_key = '3' 
      ORDER BY rm.id DESC LIMIT 2000
    `;
    const res = await db.query(q);
    let found = [];
    for (const row of res.rows) {
       try {
         const data = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
         if (data && 
            (data['pesoEje1'] === 530 || data['pesoEje1'] == '530' || data['pesoEje1'] === 530.0) && 
            (data['fuerzaFrenadoEjeDerecho1'] == 1.93 || data['fuerzaFrenadoEjeDerecho1'] == '1.93')) {
            found.push(row.inspeccion_nrodocumentoinspeccion);
         }
       } catch (e) {}
    }
    console.log('Inspecciones encontradas con 530 y 1.93:', found);
  } catch(e) { console.error(e); }
  finally { process.exit(0); }
}
run();
