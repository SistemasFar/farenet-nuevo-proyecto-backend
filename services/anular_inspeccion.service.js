const pool = require('../config/database');

const anularInspeccionConMotivo = async (nroInspeccion, motivo, observacion, usuarioSession = 'sistemas') => {
  const client = await pool.connect();

  try {
    const observacionNormalizada = String(observacion || '').trim();
    if (observacionNormalizada.length < 20) {
      throw new Error("La observación requiere mínimo 20 caracteres reales.");
    }

    const MOTIVOS_ANULACION = [
      'Saltos de correlativos',
      'Falla en la impresora',
      'Error de impresión',
      'Errores en digitación',
      'Error en consolidación',
      'Error en el proveedor'
    ];

    if (!MOTIVOS_ANULACION.includes(motivo)) {
      throw new Error("Motivo de anulación no válido.");
    }

    // Usaremos Intl para la fecha en Perú
    const formatter = new Intl.DateTimeFormat('es-PE', {
      timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit'
    });
    const currentDay = formatter.format(new Date());

    await client.query('BEGIN');

    // 1. Bloquear y validar
    const inspeccionRes = await client.query(`
      SELECT nrodocumentoinspeccion, inspeccionestado_key, fechcreacion 
      FROM inspeccion 
      WHERE nrodocumentoinspeccion = $1 FOR UPDATE
    `, [nroInspeccion]);

    if (inspeccionRes.rows.length === 0) {
      throw new Error("Inspección no encontrada.");
    }

    const inspeccion = inspeccionRes.rows[0];

    // Mismo día validation
    if (inspeccion.fechcreacion) {
      const creationDay = formatter.format(new Date(inspeccion.fechcreacion));
      if (creationDay !== currentDay) {
        throw new Error("No puede anular una inspeccion que no sea del mismo dia.");
      }
    }

    // Reinspeccion validation
    const reinspeccionRes = await client.query(`
      SELECT nrodocumentoinspeccion, inspeccionestado_key, resultado 
      FROM inspeccion 
      WHERE nrodocumentoreinspeccion = $1 
      LIMIT 1
    `, [nroInspeccion]);

    if (reinspeccionRes.rows.length > 0) {
      throw new Error(`No puede anular una inspeccion que ha sido reinspeccionada : ${reinspeccionRes.rows[0].nrodocumentoinspeccion}`);
    }

    // 2. Comprobante
    await client.query(`
      UPDATE comprobante 
      SET comprobanteestado_key = 'ANU', 
          importetotal = 0, igv = 0, baseimponible = 0, 
          fechanulacion = CURRENT_TIMESTAMP
      WHERE inspeccion_nrodocumentoinspeccion = $1
    `, [nroInspeccion]);

    // 3. Certificados
    await client.query(`
      UPDATE certificado 
      SET anulado = true, fechanulacion = CURRENT_TIMESTAMP, 
          observacionanulado = $2, usuarioanulacion_username = $3
      WHERE inspeccion_nrodocumentoinspeccion = $1
    `, [nroInspeccion, observacionNormalizada, usuarioSession]);

    // 4. Inspeccion
    await client.query(`
      UPDATE inspeccion 
      SET inspeccionestado_key = 'ANU', 
          fechanulacion = CURRENT_TIMESTAMP,
          observacionanulado = $2,
          tipoerror = $4,
          usuarioanulacion_username = $3,
          fechconsolidado = COALESCE(fechconsolidado, CURRENT_TIMESTAMP)
      WHERE nrodocumentoinspeccion = $1
    `, [nroInspeccion, observacionNormalizada, usuarioSession, motivo]);

    await client.query('COMMIT');
    
    return {
      ok: true,
      message: "La inspección ha sido anulada exitosamente a nivel local.",
      data: {
        nroInspeccion,
        estado: 'ANU',
        mtc: { intentado: false, exitoso: false, mensaje: "No migrado: se omite llamado SOAP" },
        sunat: { estado: "pendiente" }
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
  anularInspeccionConMotivo
};
