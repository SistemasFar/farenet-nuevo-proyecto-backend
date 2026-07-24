const pool = require('../config/database');
const inspeccionModel = require('../models/inspeccion.model');
const mtcService = require('./mtc.service');

const guardarDuplicadoTransaccion = async (reqBody) => {
  const { 
    placa, 
    concepto, 
    tipoContado, 
    tipoDocumento, 
    motivoDuplicado,
    plantaKey,
    precios
  } = reqBody;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Encontrar la inspeccion aprobada mas reciente y su certificado
    const inspResult = await client.query(`
      SELECT i.nrodocumentoinspeccion, i.vehiculo_nromotor, c.cliente_nrodocumentoidentidad, c.linea_key,
             cert.nrodocumentocertificado, cert.fechcreacion as cert_fechcreacion
      FROM inspeccion i
      JOIN comprobante c ON c.inspeccion_nrodocumentoinspeccion = i.nrodocumentoinspeccion
      JOIN certificado cert ON cert.inspeccion_nrodocumentoinspeccion = i.nrodocumentoinspeccion
      WHERE c.placamotor = $1 AND i.inspeccionestado_key IN ('APROBADO', 'CON')
      ORDER BY i.fechcreacion DESC
      LIMIT 1
    `, [placa]);

    if (inspResult.rows.length === 0) {
      throw new Error(`No se encontró una inspección aprobada para la placa ${placa}`);
    }

    const { nrodocumentoinspeccion, vehiculo_nromotor, cliente_nrodocumentoidentidad, linea_key, nrodocumentocertificado, cert_fechcreacion } = inspResult.rows[0];

    // 1.5 Anular Certificado Antiguo en MTC y obtener nuevo correlativo
    const anularRes = await mtcService.anularCertificadoMTC(placa, nrodocumentocertificado, motivoDuplicado, cert_fechcreacion, plantaKey);
    let nuevoCertificadoMtc = anularRes ? anularRes.nroCertificadoNuevo : nrodocumentocertificado;

    // Actualizar el certificado local con el nuevo número del MTC
    if (anularRes) {
      await client.query(`
        UPDATE certificado 
        SET nrodocumentocertificado = $1, fechmodi = NOW()
        WHERE inspeccion_nrodocumentoinspeccion = $2
      `, [nuevoCertificadoMtc, nrodocumentoinspeccion]);
    }

    // 2. Obtener la serie para el comprobante de pago en esta planta
    const serieResult = await client.query('SELECT * FROM seriedocumentobase WHERE planta_key = $1 AND documentobase_key = $2', [plantaKey, tipoDocumento]);
    if (serieResult.rows.length === 0) {
      throw new Error(`No se encontró configuración de series para la planta ${plantaKey} y documento ${tipoDocumento}`);
    }
    const serieDoc = serieResult.rows[0];

    let newNroBoleta = serieDoc.nroactualboleta || 0;
    let newNroFactura = serieDoc.nroactualfactura || 0;
    let nroComprobanteTemp = '';

    if (tipoDocumento === 'BOL') {
      newNroBoleta = parseInt(newNroBoleta) + 1;
      nroComprobanteTemp = `${serieDoc.nroserieboleta}-${String(newNroBoleta).padStart(8, '0')}`;
    } else if (tipoDocumento === 'FAC') {
      newNroFactura = parseInt(newNroFactura) + 1;
      nroComprobanteTemp = `${serieDoc.nroseriefactura}-${String(newNroFactura).padStart(8, '0')}`;
    } else {
      throw new Error(`Tipo de documento desconocido: ${tipoDocumento}`);
    }

    // Actualizar los correlativos en DB
    await client.query(`
      UPDATE seriedocumentobase SET
        nroactualboleta = $1,
        nroactualfactura = $2
      WHERE id = $3
    `, [newNroBoleta.toString(), newNroFactura.toString(), serieDoc.id]);

    const nextIdResult = await client.query("SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM comprobante");
    const nextComprobanteId = nextIdResult.rows[0].next_id;

    // 3. Insertar el Comprobante
    await client.query(`
      INSERT INTO comprobante (
        id, nrocomprobante, estado, fechcreacion, placamotor, cliente_nrodocumentoidentidad,
        conceptoinspeccion_key, linea_key, tipodocumento_key, importetotal, baseimponible, igv,
        totaldscto, totalsindscto, inspeccion_nrodocumentoinspeccion, duplicado, comprobanteestado_key
      ) VALUES ($1, $2, true, NOW(), $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, true, 'CAN')
    `, [
      nextComprobanteId,
      nroComprobanteTemp,
      placa,
      cliente_nrodocumentoidentidad,
      concepto,
      linea_key || 'LIN-DEFAULT',
      tipoDocumento,
      precios.total,
      precios.baseImponible,
      precios.igv,
      precios.descuento,
      precios.subtotal,
      nrodocumentoinspeccion
    ]);

    // 4. Insertar Pago
    const nextPagoIdResult = await client.query("SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM pago");
    let pagoId = nextPagoIdResult.rows[0].next_id;

    await client.query(`
      INSERT INTO pago (
        id, estado, fechcreacion, importe, formapago_key, comprobante_id, tipocontado_key, baseimponible, igv
      ) VALUES ($1, true, NOW(), $2, 'contado', $3, $4, $5, $6)
    `, [
      pagoId,
      precios.total,
      nextComprobanteId,
      tipoContado,
      precios.baseImponible,
      precios.igv
    ]);

    await client.query('COMMIT');

    return {
      comprobanteId: nextComprobanteId,
      nroComprobante: nroComprobanteTemp,
      inspeccionId: nrodocumentoinspeccion
    };

  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

module.exports = {
  guardarDuplicadoTransaccion
};
