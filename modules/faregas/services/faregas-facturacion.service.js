const db = require('../../../config/database');
const nubefactService = require('../../../services/integrations/nubefact.service');
const { validarAccesoPlanta } = require('./faregas-auth.service');
const { normalizarFacturacion, validarFacturacion } = require('./faregas-facturacion.rules');
const { construirPayloadNubefact, limpiarRespuestaProveedor } = require('../integrations/nubefact-faregas.adapter');

const errorNegocio = (codigo, statusCode = 400, detalles) => {
    const error = new Error(codigo);
    error.code = codigo;
    error.statusCode = statusCode;
    if (detalles) error.detalles = detalles;
    return error;
};

const obtenerCertificado = async (client, id, userContext, bloquear = false) => {
    const result = await client.query(
        `SELECT c.*, t.clave AS tipo_clave
         FROM fg_certificado c
         JOIN fg_tipo_certificado t ON t.clave = c.tipo_certificado_clave
         WHERE c.id = $1${bloquear ? ' FOR UPDATE OF c' : ''}`,
        [id]
    );
    if (result.rowCount === 0) throw errorNegocio('CERTIFICADO_NOT_FOUND', 404);
    const certificado = result.rows[0];
    const acceso = await validarAccesoPlanta(userContext.username, userContext.perfil_id, certificado.planta_key);
    if (!acceso) throw errorNegocio('PLANTA_NO_AUTORIZADA', 403);
    return certificado;
};

const obtenerOrdenPagada = async (client, certificadoId) => {
    const result = await client.query(
        `SELECT * FROM fg_orden_pago WHERE certificado_id = $1${client === db ? '' : ' FOR UPDATE'}`,
        [certificadoId]
    );
    if (result.rowCount === 0) throw errorNegocio('ORDEN_PAGO_FALTANTE', 409);
    const orden = result.rows[0];
    if (orden.estado !== 'PAGADO' || Number(orden.saldo_pendiente) > 0.009) {
        throw errorNegocio('PAGO_INCOMPLETO', 409);
    }
    return orden;
};

const respuestaPublica = (row) => {
    if (!row) return null;
    return {
        id: Number(row.id),
        certificadoId: Number(row.certificado_id),
        tipoComprobante: row.tipo_comprobante,
        tipoDocumentoCliente: row.tipo_documento_cliente,
        nroDocumento: row.nro_documento,
        nombreRazonSocial: row.nombre_razon_social,
        direccion: row.direccion,
        email: row.email,
        telefono: row.telefono,
        monedaKey: row.moneda_key,
        baseImponible: Number(row.base_imponible),
        igv: Number(row.igv),
        importeTotal: Number(row.importe_total),
        estado: row.estado,
        serie: row.serie,
        numero: row.numero === null ? null : Number(row.numero),
        nroComprobante: row.nro_comprobante,
        proveedor: row.proveedor,
        aceptadaSunat: row.aceptada_sunat,
        sunatDescription: row.sunat_description,
        sunatResponsecode: row.sunat_responsecode,
        sunatSoapError: row.sunat_soap_error,
        enlacePdf: row.enlace_pdf,
        enlaceXml: row.enlace_xml,
        enlaceCdr: row.enlace_cdr,
        intentos: Number(row.intentos || 0),
        fechaUltimoIntento: row.fecha_ultimo_intento,
        fechaAceptacion: row.fecha_aceptacion
    };
};

exports.obtenerFacturacion = async (certificadoId, userContext) => {
    await obtenerCertificado(db, certificadoId, userContext);
    const result = await db.query('SELECT * FROM fg_facturacion WHERE certificado_id = $1', [certificadoId]);
    return {
        facturacion: respuestaPublica(result.rows[0]),
        integracion: nubefactService.obtenerEstadoConfiguracion()
    };
};

exports.guardarFacturacion = async (certificadoId, data, userContext) => {
    const normalizada = normalizarFacturacion(data);
    const errores = validarFacturacion(normalizada);
    if (errores.length > 0) throw errorNegocio('DATOS_FACTURACION_INVALIDOS', 400, errores);

    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const certificado = await obtenerCertificado(client, certificadoId, userContext, true);
        if (certificado.estado !== 'BORRADOR') throw errorNegocio('CERTIFICADO_NO_EDITABLE', 409);
        const orden = await obtenerOrdenPagada(client, certificadoId);

        const actual = await client.query(
            'SELECT * FROM fg_facturacion WHERE certificado_id = $1 FOR UPDATE',
            [certificadoId]
        );
        if (actual.rowCount > 0 && ['PENDIENTE', 'ACEPTADO', 'ERROR'].includes(actual.rows[0].estado)) {
            throw errorNegocio('FACTURACION_NO_EDITABLE', 409);
        }

        const result = await client.query(
            `INSERT INTO fg_facturacion (
                certificado_id, tipo_comprobante, tipo_documento_cliente, nro_documento,
                nombre_razon_social, direccion, email, telefono, moneda_key,
                base_imponible, igv, importe_total, estado, usuario_creacion
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'BORRADOR',$13)
             ON CONFLICT (certificado_id) DO UPDATE SET
                tipo_comprobante = EXCLUDED.tipo_comprobante,
                tipo_documento_cliente = EXCLUDED.tipo_documento_cliente,
                nro_documento = EXCLUDED.nro_documento,
                nombre_razon_social = EXCLUDED.nombre_razon_social,
                direccion = EXCLUDED.direccion,
                email = EXCLUDED.email,
                telefono = EXCLUDED.telefono,
                moneda_key = EXCLUDED.moneda_key,
                base_imponible = EXCLUDED.base_imponible,
                igv = EXCLUDED.igv,
                importe_total = EXCLUDED.importe_total,
                estado = 'BORRADOR',
                aceptada_sunat = NULL,
                sunat_description = NULL,
                sunat_responsecode = NULL,
                sunat_soap_error = NULL,
                respuesta_proveedor = NULL,
                usuario_modificacion = EXCLUDED.usuario_creacion,
                fecha_modificacion = CURRENT_TIMESTAMP
             RETURNING *`,
            [
                certificadoId,
                normalizada.tipoComprobante,
                normalizada.tipoDocumentoCliente,
                normalizada.nroDocumento,
                normalizada.nombreRazonSocial,
                normalizada.direccion,
                normalizada.email,
                normalizada.telefono,
                orden.moneda_key,
                orden.baseimponible,
                orden.igv,
                orden.importe_total,
                userContext.username
            ]
        );
        await client.query('COMMIT');
        return respuestaPublica(result.rows[0]);
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

const reservarEmision = async (certificadoId, userContext) => {
    const estadoIntegracion = nubefactService.obtenerEstadoConfiguracion();
    if (!estadoIntegracion.enabled) throw errorNegocio('NUBEFACT_DESHABILITADO', 503);
    if (!estadoIntegracion.configured) throw errorNegocio('NUBEFACT_NO_CONFIGURADO', 503);

    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const certificado = await obtenerCertificado(client, certificadoId, userContext, true);
        if (certificado.estado !== 'BORRADOR') throw errorNegocio('CERTIFICADO_NO_EDITABLE', 409);
        await obtenerOrdenPagada(client, certificadoId);

        const factResult = await client.query(
            'SELECT * FROM fg_facturacion WHERE certificado_id = $1 FOR UPDATE',
            [certificadoId]
        );
        if (factResult.rowCount === 0) throw errorNegocio('FACTURACION_FALTANTE', 409);
        let facturacion = factResult.rows[0];
        if (facturacion.estado === 'ACEPTADO') {
            await client.query('COMMIT');
            return { yaAceptada: true, facturacion };
        }
        if (facturacion.estado === 'PENDIENTE' && facturacion.fecha_ultimo_intento) {
            const antiguedad = Date.now() - new Date(facturacion.fecha_ultimo_intento).getTime();
            if (antiguedad < 120000) throw errorNegocio('EMISION_EN_PROCESO', 409);
        }

        if (!facturacion.serie || facturacion.numero === null) {
            const serieResult = await client.query(
                `SELECT * FROM seriedocumentobase
                 WHERE planta_key = $1 AND COALESCE(estado, true) = true
                 ORDER BY id DESC LIMIT 1 FOR UPDATE`,
                [certificado.planta_key]
            );
            if (serieResult.rowCount === 0) throw errorNegocio('SERIE_COMPROBANTE_NO_CONFIGURADA', 409);
            const serieBase = serieResult.rows[0];
            const esFactura = facturacion.tipo_comprobante === 'FACTURA';
            const serie = esFactura ? serieBase.seriefactura : serieBase.serieboleta;
            const numero = Number(esFactura ? serieBase.nroactualfactura : serieBase.nroactualboleta) + 1;
            if (!serie || !Number.isSafeInteger(numero) || numero <= 0) {
                throw errorNegocio('SERIE_COMPROBANTE_INVALIDA', 409);
            }
            await client.query(
                `UPDATE seriedocumentobase
                 SET ${esFactura ? 'nroactualfactura' : 'nroactualboleta'} = $1, fechmodi = CURRENT_TIMESTAMP
                 WHERE id = $2`,
                [numero, serieBase.id]
            );
            facturacion.serie = serie;
            facturacion.numero = numero;
            facturacion.nro_comprobante = `${serie}-${String(numero).padStart(8, '0')}`;
        }

        const intento = Number(facturacion.intentos || 0) + 1;
        const vehiculoResult = await client.query(
            'SELECT * FROM fg_certificado_vehiculo WHERE certificado_id = $1',
            [certificadoId]
        );
        if (vehiculoResult.rowCount === 0) throw errorNegocio('VEHICULO_FALTANTE', 409);

        const updated = await client.query(
            `UPDATE fg_facturacion SET
                estado = 'PENDIENTE', serie = $1, numero = $2, nro_comprobante = $3,
                intentos = $4, fecha_ultimo_intento = CURRENT_TIMESTAMP,
                usuario_modificacion = $5, fecha_modificacion = CURRENT_TIMESTAMP
             WHERE id = $6 RETURNING *`,
            [facturacion.serie, facturacion.numero, facturacion.nro_comprobante, intento, userContext.username, facturacion.id]
        );
        facturacion = updated.rows[0];
        const payload = construirPayloadNubefact({
            facturacion,
            certificado,
            vehiculo: vehiculoResult.rows[0]
        });
        const intentoResult = await client.query(
            `INSERT INTO fg_facturacion_intento
                (facturacion_id, numero_intento, estado, solicitud)
             VALUES ($1, $2, 'PENDIENTE', $3::jsonb) RETURNING id`,
            [facturacion.id, intento, JSON.stringify(payload)]
        );
        await client.query('COMMIT');
        return {
            yaAceptada: false,
            facturacion,
            payload,
            intento,
            intentoId: intentoResult.rows[0].id
        };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

exports.emitirFacturacion = async (certificadoId, userContext, dependencies = {}) => {
    const reserva = await reservarEmision(certificadoId, userContext);
    if (reserva.yaAceptada) return respuestaPublica(reserva.facturacion);

    const proveedor = dependencies.nubefactService || nubefactService;
    const resultado = await proveedor.emitirComprobante(reserva.payload);
    const respuesta = limpiarRespuestaProveedor(resultado.data);
    const aceptada = resultado.status === 'ACCEPTED';
    const rechazada = resultado.status === 'REJECTED';
    const estado = aceptada ? 'ACEPTADO' : rechazada ? 'RECHAZADO' : 'ERROR';
    const body = respuesta || {};

    const client = await db.connect();
    try {
        await client.query('BEGIN');
        await client.query(
            `UPDATE fg_facturacion SET
                estado = $1,
                aceptada_sunat = $2,
                sunat_description = $3,
                sunat_responsecode = $4,
                sunat_soap_error = $5,
                enlace_pdf = $6,
                enlace_xml = $7,
                enlace_cdr = $8,
                cadena_qr = $9,
                codigo_hash = $10,
                respuesta_proveedor = $11::jsonb,
                fecha_aceptacion = CASE WHEN $2 THEN CURRENT_TIMESTAMP ELSE fecha_aceptacion END,
                usuario_modificacion = $12,
                fecha_modificacion = CURRENT_TIMESTAMP
             WHERE id = $13`,
            [
                estado,
                aceptada,
                body.sunat_description || body.errors || resultado.reason || null,
                body.sunat_responsecode || null,
                body.sunat_soap_error || resultado.error || null,
                body.enlace_del_pdf || body.enlace_pdf || body.enlace || null,
                body.enlace_del_xml || body.enlace_xml || null,
                body.enlace_del_cdr || body.enlace_cdr || null,
                body.cadena_para_codigo_qr || null,
                body.codigo_hash || null,
                JSON.stringify(respuesta),
                userContext.username,
                reserva.facturacion.id
            ]
        );
        await client.query(
            `UPDATE fg_facturacion_intento SET
                estado = $1, respuesta = $2::jsonb, http_status = $3,
                error = $4, fecha_finalizacion = CURRENT_TIMESTAMP
             WHERE id = $5`,
            [estado, JSON.stringify(respuesta), resultado.httpStatus || null, resultado.error || resultado.reason || null, reserva.intentoId]
        );
        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }

    const final = await db.query('SELECT * FROM fg_facturacion WHERE id = $1', [reserva.facturacion.id]);
    const facturacion = respuestaPublica(final.rows[0]);
    if (!aceptada) {
        throw errorNegocio(rechazada ? 'NUBEFACT_RECHAZADO' : 'NUBEFACT_ERROR', rechazada ? 422 : 502, {
            facturacion,
            motivo: body.sunat_description || body.errors || resultado.reason
        });
    }
    return facturacion;
};

exports._private = {
    respuestaPublica,
    errorNegocio
};
