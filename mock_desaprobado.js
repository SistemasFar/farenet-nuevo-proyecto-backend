const pool = require('./config/database');

async function run() {
  const placa = 'DES-123';
  const concepto = '3'; // Regular
  const nrodocumento = 'INS-TEST-1234';
  
  try {
    // 1. Insert Inspeccion Desaprobada (fechconsolidado = ayer)
    await pool.query(`
      INSERT INTO inspeccion (nrodocumentoinspeccion, resultado, fechconsolidado, fechcreacion, estado, tipodesaprobado)
      VALUES ($1, 'D', NOW() - INTERVAL '1 day', NOW() - INTERVAL '1 day', true, 'D')
    `, [nrodocumento]);
    
    // 2. Insert Comprobante vinculado
    await pool.query(`
      INSERT INTO comprobante (id, inspeccion_nrodocumentoinspeccion, placamotor, conceptoinspeccion_key, importetotal, estado)
      VALUES (9999999, $1, $2, $3, 100, true)
    `, [nrodocumento, placa, concepto]);
    
    console.log(`Mock creado para la placa: ${placa} (Desaprobada ayer).`);
  } catch (err) {
    console.error("Error creating mock:", err);
  }
  process.exit(0);
}
run();
