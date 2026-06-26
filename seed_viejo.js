const pool = require('./config/database');

async function run() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    const nro = "INS-TEST-VIEJO-002";
    await client.query(`
      INSERT INTO inspeccion (
        nrodocumentoinspeccion, estado, fechcreacion, fechconsolidado, resultado,
        tipodesaprobado, inspeccionestado_key, tipoautorizacion_key, tipocertificado_key, tipoinspeccion_key, indicedesaprobado
      ) VALUES ($1, true, NOW() - INTERVAL '35 days', NOW() - INTERVAL '35 days', 'D', 'D', 'CON', '1', '1', '1', 0)
    `, [nro]);

    await client.query(`
      INSERT INTO comprobante (
        id, nrocomprobante, estado, fechcreacion, placamotor,
        conceptoinspeccion_key, inspeccion_nrodocumentoinspeccion, importetotal, totalsindscto, totaldscto
      ) VALUES (99998, 'B-VIEJO', true, NOW() - INTERVAL '35 days', 'VIEJ11', '1', $1, 50, 50, 0)
    `, [nro]);

    await client.query(`
      INSERT INTO vehiculo (
        nromotor, nroplacaantigua, estado, fechcreacion, aniofabricacion, longitud, ancho, alto, 
        nroejes, nroruedas, nroasientos, nropasajeros, nropuertas, pesoseco, pesobruto, cargautil,
        distanciaeje1, distanciaeje2, distanciaeje3, distanciaeje4, kilometraje
      ) VALUES (
        'MOTOR-VIEJO', 'VIEJ11', true, NOW(), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
      ) ON CONFLICT DO NOTHING
    `);

    await client.query('COMMIT');
    console.log("¡Placa VIEJ11 inyectada (Vencida por más de 30 días)!");
  } catch (err) {
    await client.query('ROLLBACK');
    console.log(err);
  } finally {
    client.release();
  }
  process.exit(0);
}
run();
