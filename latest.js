const db = require('./config/database');
async function run() {
  try {
    const q = `
      SELECT rm.inspeccion_nrodocumentoinspeccion, rm.data, rm.postdata 
      FROM resultado_maquina rm
      JOIN maquina m ON rm.maquina_id = m.id
      WHERE m.tipomaquina_key = '3' 
      ORDER BY rm.id DESC LIMIT 1
    `;
    const res = await db.query(q);
    console.log(res.rows[0]);
  } catch(e) { console.error(e); }
  finally { process.exit(0); }
}
run();
