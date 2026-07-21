const db = require('./config/database');
async function run() {
   const q = `
      SELECT i.nrodocumentoinspeccion, i.fechcreacion, i.nrodocumentoinforme,
             ti.nombre as tipoinspeccionnombre
      FROM inspeccion i
      LEFT JOIN tipoinspeccion ti ON i.tipoinspeccion_key = ti.key
      WHERE i.nrodocumentoinspeccion = 'INS-201-000157904'
    `;
   try {
       const res = await db.query(q);
       console.log("Base data:", res.rows[0]);
   } catch(e) { console.error("Error:", e.message) }
   process.exit(0);
}
run();
