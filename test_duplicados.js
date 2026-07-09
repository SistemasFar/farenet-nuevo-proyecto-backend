const pool = require('./config/database');
async function test() {
  try {
    const res1 = await pool.query(`
      SELECT
        i.nrodocumentoinspeccion,
        i.inspeccionestado_key,
        i.posicion,
        i.estado,
        i.fechcreacion,
        c.conceptoinspeccion_key,
        c.placamotor
      FROM inspeccion i
      LEFT JOIN comprobante c
        ON c.inspeccion_nrodocumentoinspeccion = i.nrodocumentoinspeccion
      WHERE c.placamotor = 'X1A393'
      ORDER BY i.fechcreacion DESC;
    `);
    console.log('--- INSPECCIONES X1A393 ---');
    console.log(res1.rows);

    const res2 = await pool.query(`
      SELECT *
      FROM inspeccionestado
      ORDER BY key;
    `);
    console.log('--- ESTADOS ---');
    console.log(res2.rows);

    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}
test();
