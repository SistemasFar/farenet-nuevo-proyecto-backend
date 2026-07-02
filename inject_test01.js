const pool = require('./config/database');

async function inject() {
  const placa = 'TEST01';
  const conceptos = ['44', '45', '46'];
  const nroBase = 'INS-TEST2-';
  
  for (let i = 0; i < conceptos.length; i++) {
    const concepto = conceptos[i];
    const nroDoc = nroBase + (1000 + i);
    const date = new Date();
    date.setDate(date.getDate() - (5 + i));
    
    try {
      await pool.query(`
        INSERT INTO inspeccion (
          nrodocumentoinspeccion, fechcreacion, fechconsolidado, 
          inspeccionestado_key, resultado, tipodesaprobado, indicedesaprobado
        ) VALUES ($1, $2, $2, 'CON', 'D', 'L', 1)
      `, [nroDoc, date]);
      
      await pool.query(`
        INSERT INTO comprobante (
          id, nrocomprobante, estado, fechcreacion, placamotor,
          conceptoinspeccion_key, importetotal,
          inspeccion_nrodocumentoinspeccion, totaldscto, totalsindscto, baseimponible, igv, linea_key, tipodocumento_key
        ) VALUES (floor(random() * 10000000), $1, true, $2, $3, $4, 150.00, $1, 0, 150.00, 127.12, 22.88, '1', '1')
      `, [nroDoc, date, placa, concepto]);
      
      console.log(`Injected ${nroDoc} for concept ${concepto}`);
    } catch (e) {
      console.log(`Skipped ${nroDoc} due to error or already exists:`, e.message);
    }
  }
  
  process.exit(0);
}

inject().catch(console.error);
