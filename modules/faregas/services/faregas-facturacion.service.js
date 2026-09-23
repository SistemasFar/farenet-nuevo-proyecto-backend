const db = require('../../../config/database');
const nubefactService = require('../../../services/integrations/nubefact.service');
const nubefactConfigService = require('./faregas-nubefact-config.service');
const resumenTributarioService = require('./faregas-resumen-tributario.service');
const correlativosNubefactService = require('./faregas-correlativos-nubefact.service');
const readinessService = require('./faregas-nubefact-readiness.service');
const integrationsConfig = require('../../../config/integrations.config');
const chipCertificadoService = require('./faregas-chip-certificado.service');
const { validarAccesoPlanta } = require('./faregas-auth.service');
const {
    normalizarFacturacion,
    validarFacturacion,
    validarFacturacionNubefact,
    validarSerieNubefact,
    validarCuotasContraTotal,
    derivarMedioPago
} = require('./faregas-facturacion.rules');
const {
    construirPayloadNubefact,
    limpiarRespuestaProveedor,
    mapearEstadoProveedor,
    mapearAceptacionSunat,
    crearCodigoUnico
} = require('../integrations/nubefact-faregas.adapter');

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

const obtenerOrdenFacturable = async (client, certificadoId, condicionPago = 'CONTADO') => {
    const result = await client.query(
        `SELECT * FROM fg_orden_pago WHERE certificado_id = $1${client === db ? '' : ' FOR UPDATE'}`,
        [certificadoId]
    );
    if (result.rowCount === 0) throw errorNegocio('ORDEN_PAGO_FALTANTE', 409);
    const orden = result.rows[0];
    if (condicionPago === 'CONTADO' && (orden.estado !== 'PAGADO' || Number(orden.saldo_pendiente) > 0.009)) {
        throw errorNegocio('PAGO_INCOMPLETO', 409);
    }
    if (condicionPago === 'CREDITO' && Number(orden.saldo_pendiente) <= 0.009) {
        throw errorNegocio('VENTA_CREDITO_SIN_SALDO', 409);
    }
    return orden;
};

const respuestaPublica = (row, cuotas = []) => {
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
        condicionPago: row.condicion_pago || 'CONTADO',
        fechaVencimiento: row.fecha_vencimiento || null,
        medioPago: row.medio_pago || null,
        cuotas: cuotas.map(cuota => ({
            id: Number(cuota.id),
            numeroCuota: Number(cuota.numero_cuota),
            fechaPago: cuota.fecha_pago,
            importe: Number(cuota.importe),
            estado: cuota.estado
        })),
        monedaKey: row.moneda_key,
        baseImponible: Number(row.base_imponible),
        igv: Number(row.igv),
        importeTotal: Number(row.importe_total),
        estado: row.estado,
        serie: row.serie,
        numero: row.numero === null ? null : Number(row.numero),
        nroComprobante: row.nro_comprobante,
        proveedor: row.proveedor,
        plantaKey: row.planta_key || null,
        empresaKey: row.empresa_key || null,
        rucEmisor: row.ruc_emisor || null,
        razonSocialEmisor: row.razon_social_emisor || null,
        entornoFacturador: row.entorno_facturador || null,
        codigoUnico: row.codigo_unico || null,
        aceptadaSunat: row.aceptada_sunat,
        sunatDescription: row.sunat_description,
        sunatResponsecode: row.sunat_responsecode,
        sunatSoapError: row.sunat_soap_error,
        enlacePdf: row.enlace_pdf,
        enlaceXml: row.enlace_xml,
        enlaceCdr: row.enlace_cdr,
        intentos: Number(row.intentos || 0),
        fechaUltimoIntento: row.fecha_ultimo_intento,
        fechaAceptacion: row.fecha_aceptacion,
        anulacionEnPlazo: row.anulacion_en_plazo === true,
        anulacionHastaMs: row.anulacion_hasta_ms == null ? null : Number(row.anulacion_hasta_ms)
    };
};

exports.obtenerFacturacion = async (certificadoId, userContext) => {
    const certificado = await obtenerCertificado(db, certificadoId, userContext);
    const result = await db.query(`
        SELECT f.*,
               (clock_timestamp() >= emision.fecha_emision
                AND clock_timestamp() < emision.fecha_emision + INTERVAL '24 hours') AS anulacion_en_plazo,
               (EXTRACT(EPOCH FROM (emision.fecha_emision + INTERVAL '24 hours')::timestamptz) * 1000) AS anulacion_hasta_ms
        FROM fg_facturacion f
        LEFT JOIN LATERAL (
            SELECT MIN(fi.fecha_creacion) AS fecha_emision
            FROM fg_facturacion_intento fi WHERE fi.facturacion_id = f.id
        ) emision ON TRUE
        WHERE f.certificado_id = $1
    `, [certificadoId]);
    const cuotas = result.rowCount > 0
        ? await db.query('SELECT * FROM fg_facturacion_cuota WHERE facturacion_id = $1 ORDER BY numero_cuota', [result.rows[0].id])
        : { rows: [] };
    const resumenTributario = await resumenTributarioService.obtenerResumenTributario(certificadoId, db);
    return {
        facturacion: respuestaPublica(result.rows[0], cuotas.rows),
        integracion: await nubefactConfigService.obtenerEstadoParaPlanta(certificado.planta_key),
        resumenTributario
    };
};

exports.obtenerPreflight = async (certificadoId, userContext) => {
    await obtenerCertificado(db, certificadoId, userContext);
    return readinessService.evaluarCertificado(certificadoId, db);
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
        const orden = await obtenerOrdenFacturable(client, certificadoId, normalizada.condicionPago);
        const pagosPersistidos = await client.query(
            `SELECT tipocontado_key
             FROM fg_pago
             WHERE orden_pago_id = $1 AND estado = 'CAN'`,
            [orden.id]
        );
        const medioPagoPersistido = derivarMedioPago(pagosPersistidos.rows);
        const totalCuotasEsperado = Number(orden.saldo_pendiente);
        if (normalizada.condicionPago === 'CREDITO'
            && !validarCuotasContraTotal(normalizada.cuotas, totalCuotasEsperado)) {
            throw errorNegocio('CUOTAS_NO_COINCIDEN_CON_SALDO', 400, {
                saldoPendiente: totalCuotasEsperado
            });
        }

        const actual = await client.query(
            'SELECT * FROM fg_facturacion WHERE certificado_id = $1 FOR UPDATE',
            [certificadoId]
        );
        if (actual.rowCount > 0 && ['PENDIENTE', 'PENDIENTE_SUNAT', 'ACEPTADO', 'ERROR'].includes(actual.rows[0].estado)) {
            const cuotas = await client.query('SELECT * FROM fg_facturacion_cuota WHERE facturacion_id = $1 ORDER BY numero_cuota', [actual.rows[0].id]);
            await client.query("COMMIT");
            return respuestaPublica(actual.rows[0], cuotas.rows);
        }

        const result = await client.query(
            `INSERT INTO fg_facturacion (
                certificado_id, tipo_comprobante, tipo_documento_cliente, nro_documento,
                nombre_razon_social, direccion, email, telefono, moneda_key,
                base_imponible, igv, importe_total, condicion_pago,
                fecha_vencimiento, medio_pago, operacion_id, estado, usuario_creacion
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'BORRADOR',$17)
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
                condicion_pago = EXCLUDED.condicion_pago,
                fecha_vencimiento = EXCLUDED.fecha_vencimiento,
                medio_pago = EXCLUDED.medio_pago,
                operacion_id = EXCLUDED.operacion_id,
                estado = 'BORRADOR',
                aceptada_sunat = NULL,
                sunat_description = NULL,
                sunat_responsecode = NULL,
                sunat_soap_error = NULL,
                respuesta_proveedor = NULL,
                intentos = 0,
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
                normalizada.condicionPago,
                normalizada.fechaVencimiento,
                medioPagoPersistido,
                orden.operacion_id || null,
                userContext.username
            ]
        );

        await client.query('DELETE FROM fg_facturacion_intento WHERE facturacion_id = $1', [result.rows[0].id]);
        await client.query('DELETE FROM fg_facturacion_cuota WHERE facturacion_id = $1', [result.rows[0].id]);
        for (const cuota of normalizada.cuotas) {
            await client.query(
                `INSERT INTO fg_facturacion_cuota
                    (facturacion_id, numero_cuota, fecha_pago, importe)
                 VALUES ($1,$2,$3,$4)`,
                [result.rows[0].id, cuota.numeroCuota, cuota.fechaPago, cuota.importe]
            );
        }
        await client.query(
            `UPDATE fg_orden_pago SET formapago_key = $2, fechmodi = CURRENT_TIMESTAMP,
                    usuariomodi_username = $3
             WHERE id = $1`,
            [orden.id, normalizada.condicionPago === 'CREDITO' ? 'credito' : 'contado', userContext.username]
        );

        // INTEGRACION DESCUENTOS: Vincular facturacion a comprobante de descuento
        await client.query(
            `UPDATE fg_descuentocomprobante
             SET facturacion_id = $1
             WHERE certificado_id = $2 AND estado = 'APLICADO'`,
            [result.rows[0].id, certificadoId]
        );

        // Actualizar contacto del cliente si es el titular principal
        if (data.usarTitularPrincipalFac === true) {
            if (normalizada.email || normalizada.telefono) {
                let setCols = [];
                let params = [];
                let idx = 1;
                
                if (normalizada.email) {
                    setCols.push(`correo = COALESCE($${idx++}, correo)`);
                    params.push(normalizada.email);
                }
                if (normalizada.telefono) {
                    setCols.push(`telefono = COALESCE($${idx++}, telefono)`);
                    params.push(normalizada.telefono);
                }
                
                if (setCols.length > 0) {
                    params.push(normalizada.tipoDocumentoCliente);
                    params.push(normalizada.nroDocumento);
                    
                    await client.query(
                        `UPDATE fg_cliente 
                         SET ${setCols.join(', ')} 
                         WHERE tipo_documento = $${idx++} AND nro_documento = $${idx++}`,
                        params
                    );
                }
            }
        }

        await client.query('COMMIT');
        const cuotasGuardadas = await db.query(
            'SELECT * FROM fg_facturacion_cuota WHERE facturacion_id = $1 ORDER BY numero_cuota',
            [result.rows[0].id]
        );
        return respuestaPublica(result.rows[0], cuotasGuardadas.rows);
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

const reservarEmision = async (certificadoId, userContext) => {
    if (!nubefactService.obtenerEstadoConfiguracion().enabled) {
        throw errorNegocio('NUBEFACT_DESHABILITADO', 503);
    }
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const certificado = await obtenerCertificado(client, certificadoId, userContext, true);
        if (certificado.estado !== 'BORRADOR') throw errorNegocio('CERTIFICADO_NO_EDITABLE', 409);
        const factResult = await client.query(
            'SELECT * FROM fg_facturacion WHERE certificado_id = $1 FOR UPDATE',
            [certificadoId]
        );
        if (factResult.rowCount === 0) throw errorNegocio('FACTURACION_FALTANTE', 409);
        let facturacion = factResult.rows[0];
        const orden = await obtenerOrdenFacturable(client, certificadoId, facturacion.condicion_pago || 'CONTADO');
        await chipCertificadoService.validarParaFacturacion(client, certificadoId);
        const cuotasResult = await client.query(
            'SELECT * FROM fg_facturacion_cuota WHERE facturacion_id = $1 ORDER BY numero_cuota',
            [facturacion.id]
        );
        if (facturacion.condicion_pago === 'CREDITO'
            && !validarCuotasContraTotal(cuotasResult.rows, orden.saldo_pendiente)) {
            throw errorNegocio('CUOTAS_NO_COINCIDEN_CON_SALDO', 409);
        }
        if (['ACEPTADO', 'PENDIENTE_SUNAT'].includes(facturacion.estado)) {
            await client.query('COMMIT');
            return { yaAceptada: true, facturacion };
        }
        if (facturacion.estado === 'RECHAZADO') {
            throw errorNegocio('NUBEFACT_RECHAZADO', 422, {
                motivo: facturacion.sunat_description || 'El comprobante fue rechazado por Nubefact/SUNAT.'
            });
        }

        const configuracionEmisor = await nubefactConfigService.resolverParaPlanta(
            certificado.planta_key,
            client
        );
        const erroresContrato = validarFacturacionNubefact(facturacion);
        const resumenTributario = await resumenTributarioService.obtenerResumenTributario(certificadoId, client);
        if (resumenTributario.estado !== 'LISTO') {
            erroresContrato.push(...resumenTributario.errores);
        }
        if (erroresContrato.length > 0) {
            throw errorNegocio('DATOS_NUBEFACT_INVALIDOS', 409, erroresContrato);
        }
        if (facturacion.estado === 'PENDIENTE' && facturacion.fecha_ultimo_intento) {
            const antiguedad = Date.now() - new Date(facturacion.fecha_ultimo_intento).getTime();
            if (antiguedad < integrationsConfig.nubefact.retryLockMs) {
                throw errorNegocio('EMISION_EN_PROCESO', 409, {
                    reintentoDisponibleEnMs: integrationsConfig.nubefact.retryLockMs - antiguedad
                });
            }
        }
        if (Number(facturacion.intentos || 0) >= integrationsConfig.nubefact.maxAttempts) {
            throw errorNegocio('NUBEFACT_MAX_INTENTOS_ALCANZADO', 409, {
                intentos: Number(facturacion.intentos || 0),
                maximo: integrationsConfig.nubefact.maxAttempts
            });
        }

        if (!facturacion.serie || facturacion.numero === null) {
            if (!integrationsConfig.nubefact.correlativosV2Enabled) {
                throw errorNegocio('MOTOR_SERIES_V2_DESHABILITADO', 503, 'El motor de series legacy fue retirado. Habilite V2.');
            }
            const reservaCorrelativo = await correlativosNubefactService.reservarSiguiente({
                plantaKey: certificado.planta_key,
                tipoComprobante: facturacion.tipo_comprobante,
                environment: configuracionEmisor.environment
            }, client);
            facturacion.serie = reservaCorrelativo.serie;
            facturacion.numero = reservaCorrelativo.numero;
            facturacion.nro_comprobante = reservaCorrelativo.nroComprobante;
            facturacion.serie_comprobante_id = reservaCorrelativo.id;
        }

        const codigoUnico = facturacion.codigo_unico || crearCodigoUnico(facturacion.id);

        const intento = Number(facturacion.intentos || 0) + 1;
        const vehiculoResult = await client.query(
            'SELECT * FROM fg_certificado_vehiculo WHERE certificado_id = $1',
            [certificadoId]
        );
        if (vehiculoResult.rowCount === 0) throw errorNegocio('VEHICULO_FALTANTE', 409);

        const detallesNubefact = resumenTributarioService.construirDetallesNubefact(resumenTributario);

        // INTEGRACION DESCUENTOS
        const reservaResult = await client.query(
            `SELECT * FROM fg_descuentocomprobante
             WHERE facturacion_id = $1 AND estado = 'APLICADO'`,
            [facturacion.id]
        );
        const totalEsperadoConChip = Number(reservaResult.rows[0]?.importe_final || 0)
            + Number(certificado.precio_chip || 0);
        if (reservaResult.rowCount > 0 && Math.abs(totalEsperadoConChip - Number(facturacion.importe_total)) > 0.009) {
            throw errorNegocio('DESCUENTO_FACTURACION_INCONSISTENTE', 409);
        }

        const columnasReservaV2 = integrationsConfig.nubefact.correlativosV2Enabled
            ? ', serie_comprobante_id = $14, fecha_reserva_correlativo = CURRENT_TIMESTAMP'
            : '';
        const valoresReservaV2 = integrationsConfig.nubefact.correlativosV2Enabled
            ? [facturacion.serie_comprobante_id]
            : [];
        const updated = await client.query(
            `UPDATE fg_facturacion SET
                estado = 'PENDIENTE', serie = $1, numero = $2, nro_comprobante = $3,
                intentos = $4, fecha_ultimo_intento = CURRENT_TIMESTAMP,
                planta_key = $5, empresa_key = $6, ruc_emisor = $7,
                razon_social_emisor = $8, direccion_emisor = $9,
                entorno_facturador = $10, codigo_unico = $11,
                usuario_modificacion = $12, fecha_modificacion = CURRENT_TIMESTAMP
                ${columnasReservaV2}
             WHERE id = $13 RETURNING *`,
            [
                facturacion.serie,
                facturacion.numero,
                facturacion.nro_comprobante,
                intento,
                certificado.planta_key,
                configuracionEmisor.empresaKey,
                configuracionEmisor.rucEmisor,
                configuracionEmisor.razonSocialEmisor,
                configuracionEmisor.direccionEmisor,
                configuracionEmisor.environment,
                codigoUnico,
                userContext.username,
                facturacion.id,
                ...valoresReservaV2
            ]
        );
        facturacion = updated.rows[0];

        const payload = construirPayloadNubefact({
            facturacion,
            certificado,
            vehiculo: vehiculoResult.rows[0],
            reservaDescuento: reservaResult.rowCount > 0 ? reservaResult.rows[0] : null,
            detalles: detallesNubefact,
            resumenTributario,
            cuotas: cuotasResult.rows
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
            intentoId: intentoResult.rows[0].id,
            credentials: configuracionEmisor.credentials
        };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

const esPosibleDuplicadoNubefact = (resultado) => {
    const data = resultado?.data || {};
    const codigo = String(data.sunat_responsecode || data.codigo || '').trim();
    const mensaje = JSON.stringify({
        errors: data.errors || null,
        description: data.sunat_description || null,
        reason: resultado?.reason || null
    }).toLowerCase();
    return codigo === '23'
        || mensaje.includes('duplic')
        || mensaje.includes('ya existe')
        || mensaje.includes('previamente informado');
};

const consultarEmisionIncierta = async (proveedor, reserva, resultadoEmision) => {
    const debeConsultar = resultadoEmision.status === 'ERROR' || esPosibleDuplicadoNubefact(resultadoEmision);
    if (!debeConsultar || typeof proveedor.consultarComprobante !== 'function') {
        return { resultado: resultadoEmision, consulta: null };
    }

    const consulta = await proveedor.consultarComprobante({
        tipoDeComprobante: reserva.facturacion.tipo_comprobante === 'FACTURA' ? 1 : 2,
        serie: reserva.facturacion.serie,
        numero: reserva.facturacion.numero
    }, { credentials: reserva.credentials });

    return {
        resultado: ['ACCEPTED', 'PENDING_SUNAT'].includes(consulta.status) ? consulta : resultadoEmision,
        consulta
    };
};

async function persistirRespuestaNubeFact(reserva, resultadoEmision, recuperacion, userContext, hooks = {}) {
    const resultado = recuperacion.resultado;
    const respuesta = limpiarRespuestaProveedor(resultado.data);
    const respuestaPersistida = recuperacion.consulta
        ? {
            emision: limpiarRespuestaProveedor(resultadoEmision.data),
            consulta_recuperacion: limpiarRespuestaProveedor(recuperacion.consulta.data)
        }
        : respuesta;
    const aceptada = mapearAceptacionSunat(resultado);
    const pendienteSunat = resultado.status === 'PENDING_SUNAT';
    const rechazada = resultado.status === 'REJECTED';
    const estado = mapearEstadoProveedor(resultado, 'FACTURACION');
    const body = respuesta || {};

    const client = await db.connect();
    try {
        await client.query('BEGIN');
        await client.query(
            `UPDATE fg_facturacion SET
                estado = $1, aceptada_sunat = $2, sunat_description = $3, sunat_responsecode = $4,
                sunat_soap_error = $5, enlace_pdf = $6, enlace_xml = $7, enlace_cdr = $8,
                cadena_qr = $9, codigo_hash = $10, respuesta_proveedor = $11::jsonb,
                fecha_aceptacion = CASE WHEN $2 THEN CURRENT_TIMESTAMP ELSE fecha_aceptacion END,
                usuario_modificacion = $12, fecha_modificacion = CURRENT_TIMESTAMP
             WHERE id = $13`,
            [
                estado, aceptada, body.sunat_description || body.errors || resultado.reason || null,
                body.sunat_responsecode || null, body.sunat_soap_error || resultado.error || null,
                body.enlace_del_pdf || body.enlace_pdf || body.enlace || null,
                body.enlace_del_xml || body.enlace_xml || null, body.enlace_del_cdr || body.enlace_cdr || null,
                body.cadena_para_codigo_qr || null, body.codigo_hash || null,
                JSON.stringify(respuestaPersistida), userContext.username, reserva.facturacion.id
            ]
        );
        await client.query(
            `UPDATE fg_facturacion_intento SET
                estado = $1, respuesta = $2::jsonb, http_status = $3, error = $4, fecha_finalizacion = CURRENT_TIMESTAMP
             WHERE id = $5`,
            [
                estado, JSON.stringify(respuestaPersistida),
                resultado.httpStatus || resultadoEmision.httpStatus || null,
                resultado.error || resultado.reason || resultadoEmision.error || resultadoEmision.reason || null,
                reserva.intentoId
            ]
        );
        if (aceptada === true && hooks.onAceptada) {
            await hooks.onAceptada(client);
        }
        if (aceptada === true && reserva.facturacion.operacion_id) {
            await client.query(
                `UPDATE fg_operacion_comercial SET estado = 'FACTURADO', usuario_modificacion = $2, fecha_modificacion = CURRENT_TIMESTAMP WHERE id = $1`,
                [reserva.facturacion.operacion_id, userContext.username]
            );
        }
        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }

    const [final, cuotasFinales] = await Promise.all([
        db.query('SELECT * FROM fg_facturacion WHERE id = $1', [reserva.facturacion.id]),
        db.query('SELECT * FROM fg_facturacion_cuota WHERE facturacion_id = $1 ORDER BY numero_cuota', [reserva.facturacion.id])
    ]);
    const facturacion = respuestaPublica(final.rows[0], cuotasFinales.rows);
    if (!aceptada && !pendienteSunat) {
        throw errorNegocio(rechazada ? 'NUBEFACT_RECHAZADO' : 'NUBEFACT_ERROR', rechazada ? 422 : 502, {
            facturacion,
            motivo: body.sunat_description || body.errors || resultado.reason
        });
    }
    return facturacion;
}

exports.emitirFacturacion = async (certificadoId, userContext, dependencies = {}) => {
    const reserva = await reservarEmision(certificadoId, userContext);
    if (reserva.yaAceptada) {
        const client = await db.connect();
        try {
            await client.query('BEGIN');
            await chipCertificadoService.consumirEnFacturacion(client, {
                certificadoId,
                operacionId: reserva.facturacion.operacion_id,
                username: userContext.username
            });
            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
        return respuestaPublica(reserva.facturacion);
    }

    const proveedor = dependencies.nubefactService || nubefactService;
    const resultadoEmision = await proveedor.emitirComprobante(
        reserva.payload,
        { credentials: reserva.credentials }
    );
    const recuperacion = await consultarEmisionIncierta(proveedor, reserva, resultadoEmision);

    return await persistirRespuestaNubeFact(reserva, resultadoEmision, recuperacion, userContext, {
        onAceptada: async (client) => {
            await chipCertificadoService.consumirEnFacturacion(client, {
                certificadoId,
                operacionId: reserva.facturacion.operacion_id,
                username: userContext.username
            });
        }
    });
};

exports.obtenerFacturacionOperacion = async (operacionId, userContext) => {
    const opRes = await db.query('SELECT * FROM fg_operacion_comercial WHERE id=$1', [operacionId]);
    if(!opRes.rowCount) throw errorNegocio('OPERACION_NOT_FOUND', 404);
    const op = opRes.rows[0];

    const result = await db.query('SELECT * FROM fg_facturacion WHERE operacion_id = $1 AND certificado_id IS NULL', [operacionId]);
    const cuotas = result.rowCount > 0
        ? await db.query('SELECT * FROM fg_facturacion_cuota WHERE facturacion_id = $1 ORDER BY numero_cuota', [result.rows[0].id])
        : { rows: [] };

    const resumenTributario = await resumenTributarioService.obtenerResumenTributarioPorOperacion(operacionId, db);
    return {
        facturacion: respuestaPublica(result.rows[0], cuotas.rows),
        integracion: await nubefactConfigService.obtenerEstadoParaPlanta(op.planta_key),
        resumenTributario
    };
};

exports.guardarFacturacionOperacion = async (operacionId, data, userContext) => {
    const normalizada = normalizarFacturacion(data);
    const errores = validarFacturacion(normalizada);
    if (errores.length > 0) throw errorNegocio('DATOS_FACTURACION_INVALIDOS', 400, errores);

    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const opRes = await client.query('SELECT * FROM fg_operacion_comercial WHERE id=$1 FOR UPDATE', [operacionId]);
        if(!opRes.rowCount) throw errorNegocio('OPERACION_NOT_FOUND', 404);
        const op = opRes.rows[0];

        const ordenRes = await client.query('SELECT * FROM fg_orden_pago WHERE operacion_id = $1', [operacionId]);
        if(!ordenRes.rowCount) throw errorNegocio('ORDEN_PAGO_FALTANTE', 409);
        const orden = ordenRes.rows[0];

        if (normalizada.condicionPago === 'CONTADO' && (orden.estado !== 'PAGADO' || Number(orden.saldo_pendiente) > 0.009)) {
            throw errorNegocio('PAGO_INCOMPLETO', 409);
        }

        const pagosPersistidos = await client.query(
            `SELECT tipocontado_key FROM fg_pago WHERE orden_pago_id = $1 AND estado = 'CAN'`, [orden.id]
        );
        const medioPagoPersistido = derivarMedioPago(pagosPersistidos.rows);

        const actual = await client.query(
            'SELECT * FROM fg_facturacion WHERE operacion_id = $1 AND certificado_id IS NULL FOR UPDATE',
            [operacionId]
        );
        if (actual.rowCount > 0 && ['PENDIENTE', 'PENDIENTE_SUNAT', 'ACEPTADO', 'ERROR'].includes(actual.rows[0].estado)) {
            const cuotas = await client.query('SELECT * FROM fg_facturacion_cuota WHERE facturacion_id = $1 ORDER BY numero_cuota', [actual.rows[0].id]);
            await client.query("COMMIT");
            return respuestaPublica(actual.rows[0], cuotas.rows);
        }

        const result = await client.query(
            `INSERT INTO fg_facturacion (
                tipo_comprobante, tipo_documento_cliente, nro_documento,
                nombre_razon_social, direccion, email, telefono, moneda_key,
                base_imponible, igv, importe_total, condicion_pago,
                fecha_vencimiento, medio_pago, operacion_id, estado, usuario_creacion
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'BORRADOR',$16)
             ON CONFLICT (operacion_id) WHERE certificado_id IS NULL DO UPDATE SET
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
                condicion_pago = EXCLUDED.condicion_pago,
                fecha_vencimiento = EXCLUDED.fecha_vencimiento,
                medio_pago = EXCLUDED.medio_pago,
                estado = 'BORRADOR',
                aceptada_sunat = NULL,
                sunat_description = NULL,
                sunat_responsecode = NULL,
                sunat_soap_error = NULL,
                respuesta_proveedor = NULL,
                intentos = 0,
                usuario_modificacion = EXCLUDED.usuario_creacion,
                fecha_modificacion = CURRENT_TIMESTAMP
             RETURNING *`,
            [
                normalizada.tipoComprobante, normalizada.tipoDocumentoCliente, normalizada.nroDocumento,
                normalizada.nombreRazonSocial, normalizada.direccion, normalizada.email, normalizada.telefono,
                orden.moneda_key, orden.baseimponible, orden.igv, orden.importe_total,
                normalizada.condicionPago, normalizada.fechaVencimiento, medioPagoPersistido,
                operacionId, userContext.username
            ]
        );

        await client.query('DELETE FROM fg_facturacion_intento WHERE facturacion_id = $1', [result.rows[0].id]);
        await client.query('DELETE FROM fg_facturacion_cuota WHERE facturacion_id = $1', [result.rows[0].id]);
        await client.query(
            `UPDATE fg_orden_pago SET formapago_key = $2, fechmodi = CURRENT_TIMESTAMP, usuariomodi_username = $3 WHERE id = $1`,
            [orden.id, normalizada.condicionPago === 'CREDITO' ? 'credito' : 'contado', userContext.username]
        );
        await client.query('COMMIT');
        return respuestaPublica(result.rows[0], []);
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

const reservarEmisionOperacion = async (operacionId, userContext) => {
    if (!nubefactService.obtenerEstadoConfiguracion().enabled) throw errorNegocio('NUBEFACT_DESHABILITADO', 503);
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const opRes = await client.query('SELECT * FROM fg_operacion_comercial WHERE id=$1 FOR UPDATE', [operacionId]);
        if(!opRes.rowCount) throw errorNegocio('OPERACION_NOT_FOUND', 404);
        const op = opRes.rows[0];

        const factResult = await client.query('SELECT * FROM fg_facturacion WHERE operacion_id = $1 AND certificado_id IS NULL FOR UPDATE', [operacionId]);
        if (factResult.rowCount === 0) throw errorNegocio('FACTURACION_FALTANTE', 409);
        let facturacion = factResult.rows[0];

        if (['ACEPTADO', 'PENDIENTE_SUNAT'].includes(facturacion.estado)) {
            await client.query('COMMIT');
            return { yaAceptada: true, facturacion };
        }
        if (facturacion.estado === 'RECHAZADO') throw errorNegocio('NUBEFACT_RECHAZADO', 422, { motivo: facturacion.sunat_description });

        const configuracionEmisor = await nubefactConfigService.resolverParaPlanta(op.planta_key, client);
        const erroresContrato = validarFacturacionNubefact(facturacion);

        // Block if SKU is missing
        const detallesOp = await client.query('SELECT codigo_sunat_snapshot FROM fg_operacion_detalle WHERE operacion_id=$1', [operacionId]);
        for (const det of detallesOp.rows) {
            if(!det.codigo_sunat_snapshot || det.codigo_sunat_snapshot.trim() === '') {
                erroresContrato.push('El producto Chip no tiene configuración fiscal para esta sede.');
            }
        }

        const resumenTributario = await resumenTributarioService.obtenerResumenTributarioPorOperacion(operacionId, client);
        if (resumenTributario.estado !== 'LISTO') erroresContrato.push(...resumenTributario.errores);
        if (erroresContrato.length > 0) throw errorNegocio('DATOS_NUBEFACT_INVALIDOS', 409, erroresContrato);

        if (!facturacion.serie || facturacion.numero === null) {
            const reservaCorrelativo = await correlativosNubefactService.reservarSiguiente({
                plantaKey: op.planta_key,
                tipoComprobante: facturacion.tipo_comprobante,
                environment: configuracionEmisor.environment
            }, client);
            facturacion.serie = reservaCorrelativo.serie;
            facturacion.numero = reservaCorrelativo.numero;
            facturacion.nro_comprobante = reservaCorrelativo.nroComprobante;
            facturacion.serie_comprobante_id = reservaCorrelativo.id;
        }

        const codigoUnico = facturacion.codigo_unico || crearCodigoUnico(facturacion.id);
        const intento = Number(facturacion.intentos || 0) + 1;

        const detallesNubefact = resumenTributarioService.construirDetallesNubefact(resumenTributario);
        const updated = await client.query(
            `UPDATE fg_facturacion SET
                estado = 'PENDIENTE', serie = $1, numero = $2, nro_comprobante = $3,
                intentos = $4, fecha_ultimo_intento = CURRENT_TIMESTAMP,
                planta_key = $5, empresa_key = $6, ruc_emisor = $7,
                razon_social_emisor = $8, direccion_emisor = $9,
                entorno_facturador = $10, codigo_unico = $11,
                usuario_modificacion = $12, fecha_modificacion = CURRENT_TIMESTAMP
             WHERE id = $13 RETURNING *`,
            [
                facturacion.serie, facturacion.numero, facturacion.nro_comprobante, intento,
                op.planta_key, configuracionEmisor.empresaKey, configuracionEmisor.rucEmisor,
                configuracionEmisor.razonSocialEmisor, configuracionEmisor.direccionEmisor,
                configuracionEmisor.environment, codigoUnico, userContext.username, facturacion.id
            ]
        );
        facturacion = updated.rows[0];

        const payload = construirPayloadNubefact({
            facturacion,
            certificado: { planta_key: op.planta_key }, // Fake cert just for plant key if needed
            vehiculo: { placa: '-' }, // Fallback since chips dont have placa
            reservaDescuento: null,
            detalles: detallesNubefact,
            resumenTributario,
            cuotas: []
        });

        const intentoResult = await client.query(
            `INSERT INTO fg_facturacion_intento (facturacion_id, numero_intento, estado, solicitud) VALUES ($1, $2, 'PENDIENTE', $3::jsonb) RETURNING id`,
            [facturacion.id, intento, JSON.stringify(payload)]
        );
        await client.query('COMMIT');
        return {
            yaAceptada: false, facturacion, payload, intento,
            intentoId: intentoResult.rows[0].id, credentials: configuracionEmisor.credentials
        };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

exports.emitirFacturacionOperacion = async (operacionId, userContext, dependencies = {}) => {
    const reserva = await reservarEmisionOperacion(operacionId, userContext);
    if (reserva.yaAceptada) return respuestaPublica(reserva.facturacion);

    const proveedor = dependencies.nubefactService || nubefactService;
    const resultadoEmision = await proveedor.emitirComprobante(
        reserva.payload,
        { credentials: reserva.credentials }
    );
    const recuperacion = await consultarEmisionIncierta(proveedor, reserva, resultadoEmision);

    return await persistirRespuestaNubeFact(reserva, resultadoEmision, recuperacion, userContext);
};

exports._private = {
    respuestaPublica,
    errorNegocio,
    esPosibleDuplicadoNubefact,
    consultarEmisionIncierta
};


