const pool = require('../config/database');

const traspasarResultados = async (nroInspeccionAnulada, nroInspeccionNueva, placaNueva, motivoCambio, usuarioSession) => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Validar que la inspeccion antigua exista y esté en estado ANU
    const resAntigua = await client.query(`
      SELECT i.nrodocumentoinspeccion, i.inspeccionestado_key, c.placamotor
      FROM inspeccion i
      JOIN comprobante c ON i.nrodocumentoinspeccion = c.inspeccion_nrodocumentoinspeccion
      WHERE i.nrodocumentoinspeccion = $1
      ORDER BY c.fechcreacion DESC
      LIMIT 1
    `, [nroInspeccionAnulada]);

    if (resAntigua.rows.length === 0) {
      throw new Error(`La inspección ${nroInspeccionAnulada} no existe.`);
    }

    if (resAntigua.rows[0].inspeccionestado_key !== 'ANU') {
      throw new Error(`La inspección ${nroInspeccionAnulada} no está ANULADA. No se puede realizar el traspaso.`);
    }

    const placaAntigua = resAntigua.rows[0].placamotor;

    // 2. Validar que la inspeccion nueva exista y esté en estado PROCESO
    const resNueva = await client.query(`
      SELECT i.nrodocumentoinspeccion, i.inspeccionestado_key, c.placamotor
      FROM inspeccion i
      JOIN comprobante c ON i.nrodocumentoinspeccion = c.inspeccion_nrodocumentoinspeccion
      WHERE i.nrodocumentoinspeccion = $1
      ORDER BY c.fechcreacion DESC
      LIMIT 1
    `, [nroInspeccionNueva]);

    if (resNueva.rows.length === 0) {
      throw new Error(`La inspección de destino ${nroInspeccionNueva} no existe.`);
    }

    if (resNueva.rows[0].inspeccionestado_key !== 'PROCESO') {
      throw new Error(`La inspección de destino ${nroInspeccionNueva} debe estar en estado PROCESO.`);
    }

    const placaDestinoEnBD = resNueva.rows[0].placamotor;

    // Verificar que la placa ingresada en el modal coincida con la de la nueva inspección
    if (placaDestinoEnBD !== placaNueva) {
      throw new Error(`La placa de la nueva inspección (${placaDestinoEnBD}) no coincide con la placa ingresada (${placaNueva}).`);
    }

    const mismasPlacas = (placaAntigua === placaNueva);

    // 3. Obtener todos los resultados de maquina de la inspeccion anulada
    const resMaquinas = await client.query(`
      SELECT 
        manual, postdata, data, f, estado, maquina_id, 
        insp_visual, fechafin, fechainicio, foto, resultado
      FROM resultado_maquina
      WHERE inspeccion_nrodocumentoinspeccion = $1
    `, [nroInspeccionAnulada]);

    if (resMaquinas.rows.length === 0) {
      throw new Error("No hay resultados de máquina para traspasar en la inspección anulada.");
    }

    // 4. Obtener el siguiente ID de la tabla resultado_maquina (simulando secuencia/max)
    let nextRmIdRes = await client.query("SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM resultado_maquina");
    let nextRmId = parseInt(nextRmIdRes.rows[0].next_id);

    // 5. Insertar los resultados en la inspeccion nueva
    for (const rm of resMaquinas.rows) {
      // Regla de negocio: Si la placa cambió, se anulan las fotos para obligar a tomar nuevas
      let fotoFinal = rm.foto;
      if (!mismasPlacas) {
        fotoFinal = null; 
      }

      await client.query(`
        INSERT INTO resultado_maquina (
          id, manual, postdata, data, f, estado, maquina_id, fechcreacion,
          insp_visual, inspeccion_nrodocumentoinspeccion, fechafin, fechainicio,
          foto, resultado, usuariocreacion_username
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, NOW(),
          $8, $9, $10, $11,
          $12, $13, $14
        )
      `, [
        nextRmId, rm.manual, rm.postdata, rm.data, rm.f, rm.estado, rm.maquina_id,
        rm.insp_visual, nroInspeccionNueva, rm.fechafin, rm.fechainicio,
        fotoFinal, rm.resultado, usuarioSession
      ]);

      nextRmId++;
    }

    // 6. Actualizar la inspección de destino (ej: posición a FOTO si cambiaron las placas, si no se mantiene la anterior o se pone CON)
    // El Legacy actualiza posicion, por ahora replicamos si placa no coincide, pos = 'FOTO'
    const nuevaPosicion = mismasPlacas ? 'FOTO' : 'FOTO'; // Para forzar a que pasen por foto
    // Vamos a buscar la posicion de la antigua inspección
    const resAntiguaPos = await client.query(`SELECT posicion, resultado FROM inspeccion WHERE nrodocumentoinspeccion = $1`, [nroInspeccionAnulada]);
    const posAntigua = resAntiguaPos.rows[0].posicion;
    const resAntiguaResultado = resAntiguaPos.rows[0].resultado;

    const posFinal = mismasPlacas ? posAntigua : 'FOTO';

    await client.query(`
      UPDATE inspeccion 
      SET posicion = $1,
          resultado = $2
      WHERE nrodocumentoinspeccion = $3
    `, [posFinal, resAntiguaResultado, nroInspeccionNueva]);

    // 7. Guardar en el log (simulando LogUtil.writeLog de Legacy)
    // No existe tabla nativa de log en BD para traspasos según revisamos, el Legacy guarda en archivo
    console.log(`[Traspaso de Resultados] Origen: ${nroInspeccionAnulada}, Destino: ${nroInspeccionNueva}, Motivo: ${motivoCambio}, Mismas placas: ${mismasPlacas}, Usuario: ${usuarioSession}`);

    await client.query('COMMIT');
    
    return {
      message: `Resultados traspasados exitosamente. ${mismasPlacas ? 'Se copiaron con fotos.' : 'Se copiaron sin fotos (placa distinta).'}`,
      mismasPlacas: mismasPlacas
    };

  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

module.exports = {
  traspasarResultados
};
