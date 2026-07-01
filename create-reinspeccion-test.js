const pool = require('./config/database');
async function run() {
  try {
    const placa = 'REI-777';
    const concepto = '44'; // MOTO LINEAL
    const fecha = new Date();
    fecha.setDate(fecha.getDate() - 5);
    const nro = 'INS-TEST-777';

    await pool.query('BEGIN');
    
    // Check if exists and delete
    await pool.query('DELETE FROM comprobante WHERE placamotor = $1', [placa]);
    await pool.query('DELETE FROM inspeccion WHERE nrodocumentoinspeccion = $1', [nro]);

    // Insert inspeccion
    await pool.query(`
      INSERT INTO inspeccion (nrodocumentoinspeccion, fechcreacion, fechconsolidado, resultado, tipodesaprobado, inspeccionestado_key)
      VALUES ($1, $2, $2, 'D', 'D', 'CON')
    `, [nro, fecha]);

    // Insert comprobante
    await pool.query(`
      INSERT INTO comprobante (inspeccion_nrodocumentoinspeccion, placamotor, conceptoinspeccion_key, importetotal, fechcreacion)
      VALUES ($1, $2, $3, 100, $4)
    `, [nro, placa, concepto, fecha]);

    await pool.query('COMMIT');
    console.log("EJEMPLO CREADO CON EXITO: Placa REI-777, Concepto: MOTO LINEAL");
  } catch(e) {
    await pool.query('ROLLBACK');
    console.error(e);
  } finally {
    process.exit(0);
  }
}
run();
