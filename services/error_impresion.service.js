const pool = require('../config/database');

const errorImpresion = async (nrodocumentoinspeccion, observacionErrorImp, motivoError, usuarioSession) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    // 1. Obtener certificado e inspección activa
    const certQuery = await client.query(`
      SELECT c.nrodocumentocertificado, c.nrohojavalorada, c.observacion, 
             co.linea_key, i.nrodocumentoinspeccion 
      FROM certificado c
      JOIN inspeccion i ON c.inspeccion_nrodocumentoinspeccion = i.nrodocumentoinspeccion
      JOIN comprobante co ON i.nrodocumentoinspeccion = co.inspeccion_nrodocumentoinspeccion
      WHERE i.nrodocumentoinspeccion = $1 
        AND (c.anulado = false OR c.anulado IS NULL)
        AND co.comprobanteestado_key != 'ANU'
      ORDER BY co.fechcreacion DESC
      LIMIT 1
    `, [nrodocumentoinspeccion]);

    if (certQuery.rows.length === 0) {
      throw new Error("No se encontró un certificado activo para la inspección o la inspección no es válida para esta acción.");
    }

    const { nrodocumentocertificado, nrohojavalorada, observacion } = certQuery.rows[0];

    const plantaId = nrodocumentoinspeccion.split('-')[1]; // Ej: '201' de 'INS-201-000158445'
    
    // 2. Obtener siguiente número de la serie documental para certificados (incrementa y devuelve)
    // El query emula el comportamiento de NextHojaValorada
    const serieQuery = await client.query(`
      UPDATE seriedocumentobase 
      SET nroactualinforme = nroactualinforme + 1 
      WHERE planta_key = $1
      RETURNING nroactualinforme
    `, [plantaId]);
    
    if (serieQuery.rows.length === 0) {
      throw new Error("No se encontró configuración de serie documental para la planta " + plantaId);
    }
    
    // El certificado anterior tiene un formato como 'DG-200-000140821'. Vamos a extraer el prefijo y sumarle 1.
    let nuevoNroHojaValorada = "";
    if (nrohojavalorada) {
      const match = nrohojavalorada.match(/^(.*?)(\d+)$/);
      if (match) {
        const prefix = match[1];
        const numberStr = match[2];
        const nextNumber = parseInt(numberStr, 10) + 1;
        nuevoNroHojaValorada = prefix + String(nextNumber).padStart(numberStr.length, '0');
      } else {
        // Fallback
        const nextNro = serieQuery.rows[0].nroactualinforme;
        nuevoNroHojaValorada = String(nextNro).padStart(7, '0');
      }
    } else {
      // Fallback
      const nextNro = serieQuery.rows[0].nroactualinforme;
      nuevoNroHojaValorada = String(nextNro).padStart(7, '0');
    } 
    
    // 3. Registrar el error en el campo observacion (ya que no hay tabla certificadoerror)
    const logStr = `\n[Error Impresión - ${motivoError}] Papel dañado: ${nrohojavalorada}. Obs: ${observacionErrorImp}. Usuario: ${usuarioSession}`;
    const nuevaObservacion = (observacion ? observacion : "") + logStr;

    // 4. Actualizar el certificado con el nuevo papel
    await client.query(`
      UPDATE certificado 
      SET nrohojavalorada = $1, 
          observacion = $2
      WHERE nrodocumentocertificado = $3
    `, [nuevoNroHojaValorada, nuevaObservacion, nrodocumentocertificado]);

    await client.query('COMMIT');
    
    return {
      ok: true,
      message: "Certificado actualizado. Siguiente hoja valorada asignada.",
      data: {
        nuevoNroHojaValorada,
        nrodocumentocertificado
      }
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

module.exports = {
  errorImpresion
};
