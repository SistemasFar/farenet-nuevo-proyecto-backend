const pool = require('./config/database');

async function run() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Crear una inspeccion desaprobada de ayer
    const nro = "INS-TEST-DESAPROBADO-001";
    await client.query(`
      INSERT INTO inspeccion (
        nrodocumentoinspeccion, estado, fechcreacion, fechconsolidado, resultado,
        tipodesaprobado, inspeccionestado_key, tipoautorizacion_key, tipocertificado_key, tipoinspeccion_key, indicedesaprobado
      ) VALUES ($1, true, NOW() - INTERVAL '1 day', NOW() - INTERVAL '1 day', 'D', 'D', 'CON', '1', '1', '1', 0)
    `, [nro]);

    // Crear su comprobante con placa TEST-123 y concepto 1 (Liviano)
    await client.query(`
      INSERT INTO comprobante (
        id, nrocomprobante, estado, fechcreacion, placamotor,
        conceptoinspeccion_key, inspeccion_nrodocumentoinspeccion, importetotal, totalsindscto, totaldscto
      ) VALUES (99999, 'B-TEST', true, NOW() - INTERVAL '1 day', 'TEST1234', '1', $1, 50, 50, 0)
    `, [nro]);

    // Crear vehiculo
    await client.query(`
      INSERT INTO vehiculo (
        nromotor, nroplacaantigua, estado, fechcreacion, aniofabricacion, longitud, ancho, alto, 
        nroejes, nroruedas, nroasientos, nropasajeros, nropuertas, pesoseco, pesobruto, cargautil,
        distanciaeje1, distanciaeje2, distanciaeje3, distanciaeje4, kilometraje
      ) VALUES (
        'MOTOR-TEST', 'TEST1234', true, NOW(), 0, 0, 0, 0, 
        0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0
      ) ON CONFLICT DO NOTHING
    `);

    // Insertar algunos resultados maquina simulados
    await client.query(`
      INSERT INTO resultado_maquina (
        id, inspeccion_nrodocumentoinspeccion, resultado, maquina_id, fechcreacion
      ) VALUES 
        (99991, $1, 'A', 1, NOW()), -- Alineamiento Aprobado
        (99992, $1, 'A', 2, NOW()), -- Suspension Aprobado
        (99993, $1, 'D', 3, NOW())  -- Frenometro Desaprobado (Causa de la falla)
    `, [nro]);

    await client.query('COMMIT');
    console.log("¡Datos inyectados exitosamente! Prueba con la placa TEST1234");
  } catch (err) {
    await client.query('ROLLBACK');
    console.log(err);
  } finally {
    client.release();
  }
  process.exit(0);
}
run();
