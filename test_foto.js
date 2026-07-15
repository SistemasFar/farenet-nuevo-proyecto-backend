const db = require('./config/database');
async function test() {
  try {
    const { rows } = await db.query(`SELECT id, maquina_id, data, foto FROM resultado_maquina WHERE inspeccion_nrodocumentoinspeccion LIKE 'INS-201-000158749%'`);
    console.log("Filas:", rows.length);
    for (let row of rows) {
      console.log(`ID: ${row.id}, Maquina: ${row.maquina_id}, data.foto: ${row.data && row.data.foto ? 'SI ('+row.data.foto.length+')' : 'NO'}, foto_col: ${row.foto ? 'SI ('+row.foto.length+')' : 'NO'}`);
    }
  } catch (e) {
    console.error(e.message);
  } finally {
    process.exit(0);
  }
}
test();
