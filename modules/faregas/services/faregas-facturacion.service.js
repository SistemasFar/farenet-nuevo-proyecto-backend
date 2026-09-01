const db = require('../../../config/database');
const nubefactService = require('../../../services/integrations/nubefact.service');
const nubefactConfigService = require('./faregas-nubefact-config.service');
const resumenTributarioService = require('./faregas-resumen-tributario.service');
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
        fechaAceptacion: row.fecha_aceptacion
    };
};

exports.obtenerFacturacion = async (certificadoId, userContext) => {
    const certificado = await obtenerCertificado(db, certificadoId, userContext);
    const result = await db.query('SELECT * FROM fg_facturacion WHERE certificado_id = $1', [certificadoId]);
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
        if (actual.rowCount > 0 && ['PENDIENTE', 'ACEPTADO', 'ERROR'].includes(actual.rows[0].estado)) {
            throw errorNegocio('FACTURACION_NO_EDITABLE', 409);
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
        const cuotasResult = await client.query(
            'SELECT * FROM fg_facturacion_cuota WHERE facturacion_id = $1 ORDER BY numero_cuota',
            [facturacion.id]
        );
        if (facturacion.condicion_pago === 'CREDITO'
            && !validarCuotasContraTotal(cuotasResult.rows, orden.saldo_pendiente)) {
            throw errorNegocio('CUOTAS_NO_COINCIDEN_CON_SALDO', 409);
        }
        if (facturacion.estado === 'ACEPTADO') {
            await client.query('COMMIT');
            return { yaAceptada: true, facturacion };
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
            const serie = String(esFactura ? serieBase.seriefactura : serieBase.serieboleta).trim().toUpperCase();
            const numero = Number(esFactura ? serieBase.nroactualfactura : serieBase.nroactualboleta) + 1;
            if (!validarSerieNubefact(serie, facturacion.tipo_comprobante)
                || !Number.isSafeInteger(numero) || numero <= 0) {
                throw errorNegocio('SERIE_COMPROBANTE_INVALIDA', 409);
            }
            await client.query(
                `UPDATE seriedocumentobase
                 SET ${esFactura ? 'nroactualfactura' : 'nroactualboleta'} = $1, fechmodi = CURRENT_TIMESTAMP
                 WHERE id = $2`,
                [numero, serieBase.id]
            );
            await client.query(
                `UPDATE fg_serie_comprobante
                 SET ultimo_numero = GREATEST(ultimo_numero, $1), fecha_modificacion = CURRENT_TIMESTAMP
                 WHERE planta_key = $2 AND tipo_comprobante = $3 AND UPPER(BTRIM(serie)) = $4`,
                [numero, certificado.planta_key, facturacion.tipo_comprobante, serie]
            );
            facturacion.serie = serie;
            facturacion.numero = numero;
            facturacion.nro_comprobante = `${serie}-${String(numero).padStart(8, '0')}`;
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
        if (reservaResult.rowCount > 0 && Math.abs(Number(reservaResult.rows[0].importe_final) - Number(facturacion.importe_total)) > 0.009) {
            throw errorNegocio('DESCUENTO_FACTURACION_INCONSISTENTE', 409);
        }

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
                facturacion.id
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
        resultado: consulta.status === 'ACCEPTED' ? consulta : resultadoEmision,
        consulta
    };
};

exports.emitirFacturacion = async (certificadoId, userContext, dependencies = {}) => {
    const reserva = await reservarEmision(certificadoId, userContext);
    if (reserva.yaAceptada) return respuestaPublica(reserva.facturacion);

    const proveedor = dependencies.nubefactService || nubefactService;
    const resultadoEmision = await proveedor.emitirComprobante(
        reserva.payload,
        { credentials: reserva.credentials }
    );
    const recuperacion = await consultarEmisionIncierta(proveedor, reserva, resultadoEmision);
    const resultado = recuperacion.resultado;
    const respuesta = limpiarRespuestaProveedor(resultado.data);
    const respuestaPersistida = recuperacion.consulta
        ? {
            emision: limpiarRespuestaProveedor(resultadoEmision.data),
            consulta_recuperacion: limpiarRespuestaProveedor(recuperacion.consulta.data)
        }
        : respuesta;
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
                JSON.stringify(respuestaPersistida),
                userContext.username,
                reserva.facturacion.id
            ]
        );
        await client.query(
            `UPDATE fg_facturacion_intento SET
                estado = $1, respuesta = $2::jsonb, http_status = $3,
                error = $4, fecha_finalizacion = CURRENT_TIMESTAMP
             WHERE id = $5`,
            [
                estado,
                JSON.stringify(respuestaPersistida),
                resultado.httpStatus || resultadoEmision.httpStatus || null,
                resultado.error || resultado.reason || resultadoEmision.error || resultadoEmision.reason || null,
                reserva.intentoId
            ]
        );
        if (aceptada && reserva.facturacion.operacion_id) {
            await client.query(`
                UPDATE fg_operacion_comercial
                SET estado = 'FACTURADO', usuario_modificacion = $2,
                    fecha_modificacion = CURRENT_TIMESTAMP
                WHERE id = $1
            `, [reserva.facturacion.operacion_id, userContext.username]);
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
    errorNegocio,
    esPosibleDuplicadoNubefact,
    consultarEmisionIncierta
};
