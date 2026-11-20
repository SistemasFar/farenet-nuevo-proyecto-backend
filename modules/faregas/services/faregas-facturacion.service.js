const { resolverClasificacion } = require('./faregas-spot-clasificacion.service');
const db = require('../../../config/database');
const nubefactService = require('../../../services/integrations/nubefact.service');
const nubefactConfigService = require('./faregas-nubefact-config.service');
const resumenTributarioService = require('./faregas-resumen-tributario.service');
const correlativosNubefactService = require('./faregas-correlativos-nubefact.service');
const {
    validarCorrelativoDisponible,
    _private: { esNoEncontrado: esDocumentoNoEncontradoNubefact }
} = require('./faregas-nubefact-correlativo-guard.service');
const readinessService = require('./faregas-nubefact-readiness.service');
const facturacionSnapshotService = require('./faregas-facturacion-snapshot.service');
const integrationsConfig = require('../../../config/integrations.config');
const { clasificarResultado, coincideRespuestaFiscal, identificarLimiteDemo } = require('./faregas-contingencia-errores');
const chipCertificadoService = require('./faregas-chip-certificado.service');
const clientesService = require('./faregas-clientes.service');
const { esDocumentoBaseOperable, normalizarEntorno } = require('./faregas-documento-tributario-policy');
const { validarAccesoPlanta } = require('./faregas-auth.service');
const { esCodigoClasificacionSunatValidoOpcional } = require('./faregas-pagos.rules');
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

const validarCuentaDetraccionEmisor = (evaluacionSpot, configuracionEmisor) => {
    if (!evaluacionSpot?.sujeto) return;
    const cuenta = String(configuracionEmisor?.cuentaBancoNacion || '').trim();
    if (!cuenta) {
        throw errorNegocio('CUENTA_BANCO_NACION_DETRACCION_FALTANTE', 409,
            'La empresa emisora fiscal no tiene configurada su cuenta de detracciones del Banco de la Nación.');
    }
    const { esCuentaBancoNacionValida } = require('./faregas-calculo-tributario.service');
    if (!esCuentaBancoNacionValida(cuenta)) {
        throw errorNegocio('CUENTA_BANCO_NACION_DETRACCION_INVALIDA', 409,
            'La cuenta de detracciones del Banco de la Nación de la empresa emisora debe contener 11 dígitos.');
    }
};

const evaluarDatosFacturacion = (data) => {
    const datos = normalizarFacturacion(data);
    return { datos, errores: validarFacturacion(datos) };
};

const validarCreditoSinDescuentoActivo = async (client, certificadoId) => {
    if (!certificadoId) return;
    const reserva = await client.query(
        `SELECT 1 FROM fg_descuentocomprobante
         WHERE certificado_id = $1 AND estado IN ('RESERVADO', 'APLICADO')
         LIMIT 1`,
        [certificadoId]
    );
    if (reserva.rowCount > 0) throw errorNegocio('CREDITO_NO_ADMITE_DESCUENTOS', 409);
};

exports.evaluarDatosFacturacion = evaluarDatosFacturacion;

async function sincronizarDetraccionFacturacion(client, facturacionId, { tipoComprobante, importeTotal, moneda, items = [], operacionId = null }) {
    const { tieneColumna } = require('./faregas-columna-compat.service');
    const soportaDetraccion = await tieneColumna('fg_facturacion', 'sujeto_detraccion', client);
    const soportaClasificacionServicio = (await Promise.all([
        tieneColumna('fg_servicio', 'sujeto_detraccion', client),
        tieneColumna('fg_servicio', 'detraccion_codigo', client),
        tieneColumna('fg_servicio', 'detraccion_porcentaje', client)
    ])).every(Boolean);

    let itemsEvaluacion = items;
    let servicio = null;
    if (operacionId) {
        const soportaClasificacionProducto = (await Promise.all([
            tieneColumna('fg_producto_facturacion', 'sujeto_detraccion', client),
            tieneColumna('fg_producto_facturacion', 'detraccion_codigo', client),
            tieneColumna('fg_producto_facturacion', 'detraccion_porcentaje', client)
        ])).every(Boolean);
        const productoSpotSql = soportaClasificacionProducto
            ? 'pf.sujeto_detraccion, pf.detraccion_codigo, pf.detraccion_porcentaje'
            : 'NULL::boolean AS sujeto_detraccion, NULL::text AS detraccion_codigo, NULL::numeric AS detraccion_porcentaje';
        const servicioSpotSql = soportaClasificacionServicio
            ? 's.sujeto_detraccion AS servicio_sujeto_detraccion, s.detraccion_codigo AS servicio_detraccion_codigo, s.detraccion_porcentaje AS servicio_detraccion_porcentaje'
            : 'NULL::boolean AS servicio_sujeto_detraccion, NULL::text AS servicio_detraccion_codigo, NULL::numeric AS servicio_detraccion_porcentaje';
        const productos = await client.query(`
            SELECT od.tipo_item, to_jsonb(pf)->>'naturaleza_spot' AS naturaleza_spot, ${productoSpotSql}, ${servicioSpotSql}
            FROM fg_operacion_detalle od
            LEFT JOIN fg_producto_facturacion pf ON pf.id = od.producto_facturacion_id
            LEFT JOIN fg_certificado c ON c.id = od.certificado_id
            LEFT JOIN fg_tarifa t ON t.planta_key = c.planta_key AND t.codigo = c.tarifa_codigo
            LEFT JOIN fg_servicio s ON s.id = t.servicio_id
            WHERE od.operacion_id = $1
            ORDER BY od.orden, od.id
        `, [operacionId]);
        if (productos.rowCount > 0) {
            itemsEvaluacion = productos.rows.map(row => ({
                tipo_item: String(row.tipo_item || '').toUpperCase(),
                productoSpot: resolverClasificacion(row, { sujeto_detraccion: row.servicio_sujeto_detraccion, detraccion_codigo: row.servicio_detraccion_codigo, detraccion_porcentaje: row.servicio_detraccion_porcentaje })
            }));
            if (productos.rows.every(row => String(row.tipo_item || '').toUpperCase() === 'SERVICIO')) {
                const row = productos.rows[0];
                servicio = {
                    sujeto_detraccion: row.servicio_sujeto_detraccion,
                    detraccion_codigo: row.servicio_detraccion_codigo,
                    detraccion_porcentaje: row.servicio_detraccion_porcentaje
                };
            }
        }
    } else {
        const servicioResult = soportaClasificacionServicio ? await client.query(`
        SELECT to_jsonb(pf)->>'naturaleza_spot' AS naturaleza_spot,
               COALESCE((to_jsonb(pf)->>'sujeto_detraccion')::boolean, s.sujeto_detraccion) AS sujeto_detraccion,
               CASE WHEN to_jsonb(pf)->>'sujeto_detraccion' IS NOT NULL THEN to_jsonb(pf)->>'detraccion_codigo' ELSE s.detraccion_codigo END AS detraccion_codigo,
               CASE WHEN to_jsonb(pf)->>'sujeto_detraccion' IS NOT NULL THEN (to_jsonb(pf)->>'detraccion_porcentaje')::numeric ELSE s.detraccion_porcentaje END AS detraccion_porcentaje,
               s.tipo_flujo, cs.codigo AS familia
        FROM fg_facturacion f
        LEFT JOIN fg_certificado c ON c.id = f.certificado_id
        LEFT JOIN fg_operacion_detalle od ON od.operacion_id = f.operacion_id
        LEFT JOIN fg_certificado c_op ON c_op.id = od.certificado_id
        JOIN fg_tarifa t ON t.planta_key = COALESCE(c.planta_key, c_op.planta_key)
                         AND t.codigo = COALESCE(c.tarifa_codigo, c_op.tarifa_codigo)
        JOIN fg_servicio s ON s.id = t.servicio_id
        LEFT JOIN fg_producto_facturacion pf ON pf.id = t.producto_facturacion_id
        LEFT JOIN fg_categoria_servicio cs ON cs.id = s.categoria_id
        WHERE f.id = $1 LIMIT 1
        `, [facturacionId]) : { rows: [] };
        servicio = servicioResult.rows[0] || null;
    }
    const { evaluarDetraccion } = require('./faregas-detracciones.service');
    const evaluacion = evaluarDetraccion({
        tipoComprobante, importeTotal, moneda: moneda || 'PEN', items: itemsEvaluacion, servicio,
        esGratuito: Number(importeTotal) <= 0
    });
    if (evaluacion.requiereRevision) {
        const detalle = evaluacion.motivoExclusion === 'CONCEPTOS_MIXTOS_REQUIEREN_REVISION'
            ? 'La factura combina productos y servicios con bases SPOT distintas o incompletas. Revise y separe los conceptos antes de emitir.'
            : operacionId
                ? 'La clasificación SPOT del producto vendido no está verificada o no corresponde a una categoría de bienes compatible. Revise Configuración → Productos antes de emitir.'
                : 'La clasificación SPOT del servicio no está verificada; complete la configuración tributaria antes de emitir.';
        throw errorNegocio(evaluacion.motivoExclusion, 409, detalle);
    }
    if (!soportaDetraccion && evaluacion.sujeto) throw errorNegocio('MIGRACION_DETRACCIONES_REQUERIDA', 503,
        'La migración FAREGAS 004 no está aplicada: la factura sujeta a SPOT no se puede guardar ni emitir hasta habilitar su persistencia.');
    if (!soportaDetraccion) return evaluacion;
    await client.query(`
        UPDATE fg_facturacion SET
            sujeto_detraccion = $1, detraccion_codigo = $2, detraccion_descripcion = $3,
            detraccion_porcentaje = $4, detraccion_base = $5, detraccion_monto = $6,
            detraccion_neto = $7, detraccion_estado_deposito = $8,
            detraccion_motivo_exclusion = $9
        WHERE id = $10
    `, [evaluacion.sujeto, evaluacion.codigo, evaluacion.descripcion, evaluacion.porcentaje,
        evaluacion.base, evaluacion.monto, evaluacion.neto, evaluacion.estadoDeposito,
        evaluacion.motivoExclusion, facturacionId]);
    return evaluacion;
}


const obtenerCertificado = async (client, id, userContext, bloquear = false) => {
    const result = await client.query(
        `SELECT c.*, t.clave AS tipo_clave,
                s.tipo_flujo AS servicio_tipo_flujo
         FROM fg_certificado c
         JOIN fg_tipo_certificado t ON t.clave = c.tipo_certificado_clave
         LEFT JOIN fg_tarifa tf
           ON tf.planta_key = c.planta_key
          AND tf.codigo = c.tarifa_codigo
         LEFT JOIN fg_servicio s ON s.id = tf.servicio_id
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

const esFalloTemporalProveedor = (facturacion) => {
    if (!facturacion) return false;
    const resp = typeof facturacion.respuesta_proveedor === 'string'
        ? (() => { try { return JSON.parse(facturacion.respuesta_proveedor); } catch { return {}; } })()
        : (facturacion.respuesta_proveedor || {});
    const desc = facturacion.sunat_description || '';
    const errs = JSON.stringify(resp);
    if (identificarLimiteDemo(desc, errs, resp.errors, resp.message, resp.mensaje)) {
        return true;
    }
    const codigoProveedor = resp.codigo || resp.sunat_responsecode;
    const tieneCodigoFiscalSunat = Boolean(facturacion.sunat_responsecode && String(facturacion.sunat_responsecode).trim() !== '0');
    if (tieneCodigoFiscalSunat) {
        return false;
    }
    if (String(codigoProveedor) === '21' || resp.status === 'ERROR' || resp.reason === 'TIMEOUT' || resp.reason === 'NETWORK_ERROR' || resp.reason === 'PROVIDER_HTTP_ERROR') {
        return true;
    }
    const httpStatus = Number(resp.httpStatus);
    if ([408, 429, 500, 502, 503, 504].includes(httpStatus)) {
        return true;
    }
    return false;
};

const esRechazoFiscalDefinitivo = (facturacion) => {
    if (!facturacion) return false;
    if (esFalloTemporalProveedor(facturacion)) return false;
    const tieneCodigoFiscal = Boolean(facturacion.sunat_responsecode && String(facturacion.sunat_responsecode).trim() !== '0');
    return facturacion.estado === 'RECHAZADO' && (tieneCodigoFiscal || facturacion.aceptada_sunat === false);
};

const respuestaPublica = (row, cuotas = []) => {
    if (!row) return null;
    return {
        id: Number(row.id),
        certificadoId: row.certificado_id == null ? null : Number(row.certificado_id),
        operacionId: row.operacion_id == null ? null : Number(row.operacion_id),
        tipoComprobante: row.tipo_comprobante,
        tipoDocumentoCliente: row.tipo_documento_cliente,
        nroDocumento: row.nro_documento,
        nombreRazonSocial: row.nombre_razon_social,
        direccion: row.direccion,
        email: row.email,
        telefono: row.telefono,
        fechaDocumento: row.fecha_documento_iso || row.fecha_documento || null,
        sedeNombre: row.sede_nombre_snapshot || null,
        sedeDireccion: row.sede_direccion_snapshot || null,
        sedeTelefono: row.sede_telefono_snapshot || null,
        sedeCorreo: row.sede_correo_snapshot || null,
        codigoDescuento: row.codigo_descuento_snapshot || null,
        condicionPago: row.condicion_pago || 'CONTADO',
        fechaInicioCredito: row.fecha_inicio_credito || null,
        fechaVencimiento: row.fecha_vencimiento || null,
        medioPago: row.medio_pago || null,
        facturarAlDuenoPrincipal: row.facturar_al_dueno_principal === true,
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
        motivoLimiteDemo: row.estado === 'RECHAZADO' ? identificarLimiteDemo(row.sunat_description,
            row.respuesta_proveedor?.errors, row.respuesta_proveedor?.emision?.errors) : null,
        esRechazoDefinitivo: esRechazoFiscalDefinitivo(row),
        esFalloTemporal: esFalloTemporalProveedor(row),
        sunatResponsecode: row.sunat_responsecode,
        sunatSoapError: row.sunat_soap_error,
        enlacePdf: row.enlace_pdf,
        enlacePdfFaregas: row.enlace_pdf_faregas || null,
        enlaceXml: row.enlace_xml,
        enlaceCdr: row.enlace_cdr,
        intentos: Number(row.intentos || 0),
        fechaUltimoIntento: row.fecha_ultimo_intento,
        fechaAceptacion: row.fecha_aceptacion,
        anulacionEnPlazo: row.anulacion_en_plazo === true,
        anulacionHastaMs: row.anulacion_hasta_ms == null ? null : Number(row.anulacion_hasta_ms),
        tieneNotaCredito: row.tiene_nota_credito === true
    };
};

exports.obtenerFacturacion = async (certificadoId, userContext) => {
    const certificado = await obtenerCertificado(db, certificadoId, userContext);
    const result = await db.query(`
        SELECT f.*, f.fecha_documento::text AS fecha_documento_iso, op.fecha_inicio_credito,
               (clock_timestamp() >= emision.fecha_emision
                AND clock_timestamp() < emision.fecha_emision + INTERVAL '24 hours') AS anulacion_en_plazo,
               (EXTRACT(EPOCH FROM (emision.fecha_emision + INTERVAL '24 hours')::timestamptz) * 1000) AS anulacion_hasta_ms,
               EXISTS (SELECT 1 FROM fg_credito cr WHERE cr.facturacion_id = f.id) AS tiene_nota_credito
        FROM fg_facturacion f
        LEFT JOIN fg_orden_pago op ON op.certificado_id = f.certificado_id
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

exports.obtenerPreflight = async (certificadoId, userContext, dependencies = {}) => {
    await obtenerCertificado(db, certificadoId, userContext);
    const preparacionFiscal = await readinessService.evaluarCertificado(certificadoId, db);
    const certService = dependencies.certificadosService || require('./faregas-certificados.service');
    const validacionTecnica = await certService.validarEmision(certificadoId, userContext, {
        ignorarComprobanteNoEmitido: true,
        ignorarChipNoConsumido: true
    });
    if (validacionTecnica?.valido) return preparacionFiscal;

    const bloqueosTecnicos = (validacionTecnica?.errores || []).map((error) => ({
        codigo: error.codigo || 'CERTIFICADO_TECNICO_INCOMPLETO',
        estado: 'BLOQUEO',
        mensaje: error.mensaje || String(error),
        detalles: {
            seccion: error.seccion || null,
            campo: error.campo || null
        }
    }));
    return {
        ...preparacionFiscal,
        estado: 'BLOQUEADO',
        bloqueos: Number(preparacionFiscal.bloqueos || 0) + bloqueosTecnicos.length,
        checks: [...(preparacionFiscal.checks || []), ...bloqueosTecnicos]
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
        if (normalizada.condicionPago === 'CREDITO') {
            await validarCreditoSinDescuentoActivo(client, certificadoId);
        }
        const pagosPersistidos = await client.query(
            `SELECT p.tipocontado_key, p.tarjeta_key, p.modalidad_tarjeta, p.importe,
                    t.nombre AS tarjeta_nombre, ef.nombre AS entidad_nombre
             FROM fg_pago p
             LEFT JOIN tarjeta t ON t.key = p.tarjeta_key
             LEFT JOIN entidadfinanciera ef ON ef.key = p.entidadfinanciera_key
             WHERE p.orden_pago_id = $1 AND p.estado = 'CAN'
             ORDER BY p.id ASC`,
            [orden.id]
        );
        if (normalizada.condicionPago === 'CREDITO' && pagosPersistidos.rowCount > 0) {
            throw errorNegocio('CREDITO_CON_PAGOS_EXISTENTES', 409);
        }
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
        const yaTieneComprobante = actual.rowCount > 0 && Boolean(
            actual.rows[0].codigo_hash
            && (actual.rows[0].enlace_pdf || actual.rows[0].enlace_xml)
            && actual.rows[0].nro_comprobante
        );
        const tieneCorrelativoAsignado = actual.rowCount > 0 && Boolean(
            actual.rows[0].serie && actual.rows[0].numero !== null
        );
        if (actual.rowCount > 0 && (['PENDIENTE', 'PENDIENTE_SUNAT', 'ACEPTADO', 'ERROR', 'RECHAZADO'].includes(actual.rows[0].estado) || tieneCorrelativoAsignado || yaTieneComprobante)) {
            const cuotas = await client.query('SELECT * FROM fg_facturacion_cuota WHERE facturacion_id = $1 ORDER BY numero_cuota', [actual.rows[0].id]);
            await client.query("COMMIT");
            return respuestaPublica(actual.rows[0], cuotas.rows);
        }

        const result = await client.query(
            `INSERT INTO fg_facturacion (
                certificado_id, tipo_comprobante, tipo_documento_cliente, nro_documento,
                nombre_razon_social, direccion, email, telefono, moneda_key,
                base_imponible, igv, importe_total, condicion_pago,
                fecha_vencimiento, medio_pago, operacion_id,
                facturar_al_dueno_principal, estado, usuario_creacion
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'BORRADOR',$18)
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
                facturar_al_dueno_principal = EXCLUDED.facturar_al_dueno_principal,
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
                normalizada.facturarAlDuenoPrincipal,
                userContext.username
            ]
        );

        await sincronizarDetraccionFacturacion(client, result.rows[0].id, {
            tipoComprobante: normalizada.tipoComprobante,
            importeTotal: orden.importe_total,
            moneda: orden.moneda_key
        });
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
            `UPDATE fg_orden_pago SET formapago_key = $2,
                    fecha_inicio_credito = $3, fecha_vencimiento_credito = $4,
                    fechmodi = CURRENT_TIMESTAMP, usuariomodi_username = $5
             WHERE id = $1`,
            [
                orden.id,
                normalizada.condicionPago === 'CREDITO' ? 'credito' : 'contado',
                normalizada.condicionPago === 'CREDITO' ? normalizada.fechaInicioCredito : null,
                normalizada.condicionPago === 'CREDITO' ? normalizada.fechaVencimiento : null,
                userContext.username
            ]
        );
        // INTEGRACION DESCUENTOS: Vincular facturacion a comprobante de descuento
        await client.query(
            `UPDATE fg_descuentocomprobante
             SET facturacion_id = $1
             WHERE certificado_id = $2 AND estado = 'APLICADO'`,
            [result.rows[0].id, certificadoId]
        );

        result.rows[0] = await facturacionSnapshotService.capturarSnapshotFacturacion({
            queryable: client,
            facturacionId: result.rows[0].id,
            certificadoId
        });
        result.rows[0].fecha_inicio_credito = normalizada.condicionPago === 'CREDITO'
            ? normalizada.fechaInicioCredito
            : null;

        // El cliente fiscal queda reutilizable desde la lupa, sea el titular o
        // un tercero. Se hace dentro de la misma transacción del comprobante:
        // nunca por tecla y nunca antes de que el conjunto fiscal sea válido.
        await clientesService.asegurarCliente({
            tipoDocumento: normalizada.tipoDocumentoCliente,
            nroDocumento: normalizada.nroDocumento,
            nombreRazonSocial: normalizada.nombreRazonSocial,
            direccion: normalizada.direccion,
            correo: normalizada.email,
            telefono: normalizada.telefono
        }, client);

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

const reservarEmision = async (certificadoId, userContext, dependencies = {}, opciones = {}) => {
    const nubefact = dependencies.nubefactService || nubefactService;
    if (!nubefact.obtenerEstadoConfiguracion().enabled) {
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
        if (facturacion.condicion_pago === 'CREDITO') {
            await validarCreditoSinDescuentoActivo(client, certificadoId);
        }
        await chipCertificadoService.validarParaFacturacion(client, certificadoId);
        const cuotasResult = await client.query(
            'SELECT * FROM fg_facturacion_cuota WHERE facturacion_id = $1 ORDER BY numero_cuota',
            [facturacion.id]
        );
        if (facturacion.condicion_pago === 'CREDITO'
            && !validarCuotasContraTotal(cuotasResult.rows, orden.saldo_pendiente)) {
            throw errorNegocio('CUOTAS_NO_COINCIDEN_CON_SALDO', 409);
        }
        if (['ACEPTADO', 'PENDIENTE_SUNAT'].includes(facturacion.estado) || Boolean(facturacion.codigo_hash && facturacion.enlace_pdf)) {
            if (facturacion.estado === 'BORRADOR' && Boolean(facturacion.codigo_hash && facturacion.enlace_pdf)) {
                const entornoFact = normalizarEntorno(facturacion.entorno_facturador || integrationsConfig.nubefact.environment);
                const nuevoEstado = entornoFact === 'DEMO' ? 'PENDIENTE_SUNAT' : facturacion.estado;
                if (nuevoEstado !== facturacion.estado) {
                    await client.query(
                        `UPDATE fg_facturacion SET estado = $1, usuario_modificacion = $2, fecha_modificacion = CURRENT_TIMESTAMP WHERE id = $3`,
                        [nuevoEstado, userContext.username, facturacion.id]
                    );
                    facturacion.estado = nuevoEstado;
                }
            }
            await client.query('COMMIT');
            return { yaAceptada: true, facturacion };
        }
        if (facturacion.estado === 'RECHAZADO') {
            if (esRechazoFiscalDefinitivo(facturacion)) {
                throw errorNegocio('NUBEFACT_RECHAZADO', 422, {
                    motivo: facturacion.sunat_description || 'El comprobante tiene un rechazo fiscal definitivo de SUNAT y requiere revisión operativa.'
                });
            }
            if (!opciones.reintentarRechazada && !esFalloTemporalProveedor(facturacion)) {
                throw errorNegocio('NUBEFACT_RECHAZADO', 422, {
                    motivo: facturacion.sunat_description || 'El comprobante fue rechazado por Nubefact/SUNAT.'
                });
            }
            if (!facturacion.serie || facturacion.numero === null || !facturacion.nro_comprobante) {
                throw errorNegocio('REINTENTO_CORRELATIVO_INVALIDO', 409, {
                    motivo: 'La facturación rechazada no tiene serie y número persistidos; no se puede reintentar sin reservar otro correlativo.'
                });
            }
        }

        // PREVALIDACIÓN TÉCNICA OBLIGATORIA:
        // Antes de llamar a NubeFact o emitir cualquier comprobante, validar
        // que el certificado esté técnicamente completo usando el validador oficial.
        const certService = dependencies?.certificadosService || require('./faregas-certificados.service');
        const validacionTecnica = await certService.validarEmision(certificadoId, userContext, {
            ignorarComprobanteNoEmitido: true,
            ignorarChipNoConsumido: true
        });
        if (!validacionTecnica?.valido) {
            const primerError = validacionTecnica.errores?.[0]?.mensaje
                || (typeof validacionTecnica.errores?.[0] === 'string' ? validacionTecnica.errores[0] : null)
                || 'El certificado presenta observaciones técnicas pendientes.';
            throw errorNegocio('CERTIFICADO_NO_VALIDO_PARA_EMISION', 400, {
                mensaje: `No se puede emitir el comprobante porque el certificado presenta observaciones técnicas: ${primerError}`,
                errores: validacionTecnica.errores
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

        let correlativoVerificadoEnNubeFact = false;
        if (!facturacion.serie || facturacion.numero === null) {
            if (!integrationsConfig.nubefact.correlativosV2Enabled) {
                throw errorNegocio('MOTOR_SERIES_V2_DESHABILITADO', 503, 'El motor de series legacy fue retirado. Habilite V2.');
            }
            const argumentosCorrelativo = {
                plantaKey: certificado.planta_key,
                empresaKey: configuracionEmisor.empresaKey,
                tipoComprobante: facturacion.tipo_comprobante,
                environment: configuracionEmisor.environment
            };
            const reservaCorrelativo = ['FACTURA', 'BOLETA'].includes(facturacion.tipo_comprobante)
                ? await correlativosNubefactService.reservarSiguienteDisponible({
                    ...argumentosCorrelativo,
                    provider: nubefact,
                    credentials: configuracionEmisor.credentials
                }, client)
                : await correlativosNubefactService.reservarSiguiente(argumentosCorrelativo, client);
            facturacion.serie = reservaCorrelativo.serie;
            facturacion.numero = reservaCorrelativo.numero;
            facturacion.nro_comprobante = reservaCorrelativo.nroComprobante;
            facturacion.serie_comprobante_id = reservaCorrelativo.id;
            correlativoVerificadoEnNubeFact = reservaCorrelativo.disponibleEnNubefact === true;
        }

        if (!correlativoVerificadoEnNubeFact) {
            if (typeof nubefact?.consultarComprobante === 'function' && facturacion.serie && facturacion.numero !== null) {
                const consultaPrevia = await nubefact.consultarComprobante({
                    tipoDeComprobante: facturacion.tipo_comprobante === 'FACTURA' ? 1 : 2,
                    serie: facturacion.serie,
                    numero: facturacion.numero
                }, { credentials: configuracionEmisor.credentials });

                if (['ACCEPTED', 'PENDING_SUNAT'].includes(consultaPrevia?.status)) {
                    const datosConsulta = consultaPrevia.data || {};
                    const nuevoEstado = consultaPrevia.status === 'ACCEPTED' ? 'ACEPTADO' : 'PENDIENTE_SUNAT';
                    await client.query(
                        `UPDATE fg_facturacion SET
                            estado = $1, aceptada_sunat = $2, sunat_description = $3,
                            enlace_pdf = COALESCE($4, enlace_pdf), enlace_xml = COALESCE($5, enlace_xml),
                            enlace_cdr = COALESCE($6, enlace_cdr), codigo_hash = COALESCE($7, codigo_hash),
                            respuesta_proveedor = $8::jsonb, usuario_modificacion = $9, fecha_modificacion = CURRENT_TIMESTAMP
                         WHERE id = $10`,
                        [
                            nuevoEstado,
                            consultaPrevia.status === 'ACCEPTED',
                            datosConsulta.sunat_description || null,
                            datosConsulta.enlace_del_pdf || datosConsulta.enlace_pdf || null,
                            datosConsulta.enlace_del_xml || datosConsulta.enlace_xml || null,
                            datosConsulta.enlace_del_cdr || datosConsulta.enlace_cdr || null,
                            datosConsulta.codigo_hash || null,
                            JSON.stringify(consultaPrevia),
                            userContext.username,
                            facturacion.id
                        ]
                    );
                    const updatedFact = await client.query('SELECT * FROM fg_facturacion WHERE id = $1', [facturacion.id]);
                    await client.query('COMMIT');
                    return { yaAceptada: true, facturacion: updatedFact.rows[0] };
                }
            }

            await validarCorrelativoDisponible(nubefact, {
                tipoComprobante: facturacion.tipo_comprobante,
                serie: facturacion.serie,
                numero: facturacion.numero,
                credentials: configuracionEmisor.credentials
            });
        }

        const codigoUnico = facturacion.codigo_unico || crearCodigoUnico(facturacion.id);

        const intento = Number(facturacion.intentos || 0) + 1;
        const vehiculoResult = await client.query(
            'SELECT * FROM fg_certificado_vehiculo WHERE certificado_id = $1',
            [certificadoId]
        );
        const esInspeccionTaller = String(certificado.servicio_tipo_flujo || '').toUpperCase() === 'TALLER_INSPECCION';
        if (!esInspeccionTaller && vehiculoResult.rowCount === 0) throw errorNegocio('VEHICULO_FALTANTE', 409);

        const detallesNubefact = resumenTributarioService.construirDetallesNubefact(resumenTributario);

        // INTEGRACION DESCUENTOS
        const reservaResult = await client.query(
            `SELECT cmp.*,
                    COALESCE(dc.codigo, CASE WHEN d.id = 17 OR UPPER(BTRIM(d.codigo)) = 'D_CONVENIO_A88137BB742F4157' OR EXISTS (SELECT 1 FROM fg_descuentocliente dcp WHERE dcp.descuento_id = d.id AND UPPER(BTRIM(dcp.codigo)) IN ('CORTESIA_FAREGAS', 'DESCUENTO_TALLER')) THEN 'CORTESIA_FAREGAS' ELSE d.codigo END) AS codigo_autorizacion,
                    COALESCE(dc.codigo, d.nombre) AS codigo,
                    d.tipo AS descuento_tipo, d.activo AS descuento_activo
             FROM fg_descuentocomprobante cmp
             LEFT JOIN fg_descuentocliente dc ON dc.id = cmp.descuento_cliente_id
             LEFT JOIN fg_descuento d ON d.id = COALESCE(cmp.descuento_id, dc.descuento_id)
             WHERE cmp.facturacion_id = $1 AND cmp.estado = 'APLICADO'`,
            [facturacion.id]
        );
        const totalEsperadoConChip = Number(reservaResult.rows[0]?.importe_final || 0)
            + Number(certificado.precio_chip || 0);
        if (reservaResult.rowCount > 0 && Math.abs(totalEsperadoConChip - Number(facturacion.importe_total)) > 0.009) {
            throw errorNegocio('DESCUENTO_FACTURACION_INCONSISTENTE', 409);
        }

        const documentoReservado = {
            serie: facturacion.serie,
            numero: facturacion.numero,
            nro_comprobante: facturacion.nro_comprobante,
            serie_comprobante_id: facturacion.serie_comprobante_id
        };
        facturacion = await facturacionSnapshotService.capturarSnapshotFacturacion({
            queryable: client,
            facturacionId: facturacion.id,
            certificadoId,
            fechaDocumento: facturacionSnapshotService.fechaPeruIso()
        });
        Object.assign(facturacion, documentoReservado);

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
        const evalSpotCert = await sincronizarDetraccionFacturacion(client, facturacion.id, {
            tipoComprobante: facturacion.tipo_comprobante,
            importeTotal: facturacion.importe_total,
            moneda: facturacion.moneda_key,
            items: detallesNubefact
        });
        if (evalSpotCert) Object.assign(facturacion, {
            sujeto_detraccion: evalSpotCert.sujeto,
            detraccion_codigo: evalSpotCert.codigo,
            detraccion_descripcion: evalSpotCert.descripcion,
            detraccion_porcentaje: evalSpotCert.porcentaje,
            detraccion_base: evalSpotCert.base,
            detraccion_monto: evalSpotCert.monto,
            detraccion_neto: evalSpotCert.neto,
            detraccion_estado_deposito: evalSpotCert.estadoDeposito,
            detraccion_motivo_exclusion: evalSpotCert.motivoExclusion
        });
        validarCuentaDetraccionEmisor(evalSpotCert, configuracionEmisor);

        const payload = construirPayloadNubefact({
            facturacion,
            certificado,
            vehiculo: vehiculoResult.rows[0] || {},
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
    const diagnostico = clasificarResultado(resultadoEmision);
    const diagnosticoDiferible = integrationsConfig.contingencia?.habilitada && reserva.facturacion.certificado_id
        && (diagnostico.recuperable || diagnostico.categoria === 'LIMITE_DEMO_AGOTADO');
    const debeConsultar = resultadoEmision.status === 'ERROR' || esPosibleDuplicadoNubefact(resultadoEmision) || diagnosticoDiferible;
    if (!debeConsultar || typeof proveedor.consultarComprobante !== 'function') {
        return { resultado: resultadoEmision, consulta: null };
    }

    const consulta = await proveedor.consultarComprobante({
        tipoDeComprobante: reserva.facturacion.tipo_comprobante === 'FACTURA' ? 1 : 2,
        serie: reserva.facturacion.serie,
        numero: reserva.facturacion.numero
    }, { credentials: reserva.credentials });

    const data = consulta?.data || {};
    const consultaConfirmaDocumento = ['ACCEPTED', 'PENDING_SUNAT'].includes(consulta?.status)
        || (consulta?.status === 'REJECTED'
            && !esDocumentoNoEncontradoNubefact(consulta)
            && Boolean(data.serie || data.numero || data.sunat_responsecode
                || data.codigo_hash || data.enlace_del_pdf || data.enlace_pdf));

    return {
        resultado: consultaConfirmaDocumento && (!diagnosticoDiferible || coincideRespuestaFiscal(reserva.facturacion, consulta))
            ? consulta : resultadoEmision,
        consulta
    };
};

async function persistirRespuestaNubeFact(reserva, resultadoEmision, recuperacion, userContext, hooks = {}) {
    const resultado = recuperacion.resultado;
    const respuesta = limpiarRespuestaProveedor(resultado.data);
    let respuestaPersistida = recuperacion.consulta
        ? {
            emision: limpiarRespuestaProveedor(resultadoEmision.data),
            consulta_recuperacion: limpiarRespuestaProveedor(recuperacion.consulta.data)
        }
        : respuesta;
    const diagnosticoFiscal = !['ACCEPTED', 'PENDING_SUNAT'].includes(resultado.status)
        ? clasificarResultado(resultado, recuperacion.consulta, reserva.intentoId) : null;
    const diagnostico = hooks.diagnosticarContingencia || diagnosticoFiscal?.categoria === 'LIMITE_DEMO_AGOTADO'
        ? diagnosticoFiscal : null;
    if (diagnostico) respuestaPersistida = { ...respuestaPersistida, _faregas_contingencia: diagnostico };
    const aceptada = diagnostico?.recuperable ? null : mapearAceptacionSunat(resultado);
    const pendienteSunat = resultado.status === 'PENDING_SUNAT';
    const rechazada = resultado.status === 'REJECTED' && !diagnostico?.recuperable;
    const estado = diagnostico?.recuperable ? 'ERROR' : mapearEstadoProveedor(resultado, 'FACTURACION');
    const body = respuesta || {};

    const client = await db.connect();
    try {
        await client.query('BEGIN');
        // FASE 2: compatibilidad transparente antes y después de migración.
        // Se consulta existencia de columna sin abortar la transacción PostgreSQL.
        const { tieneColumna } = require('./faregas-columna-compat.service');
        const soportaFechaHora = await tieneColumna('fg_facturacion', 'fecha_hora_emision');
        const paramsUpdate = [
            estado, aceptada, body.sunat_description || body.errors || resultado.reason || null,
            body.sunat_responsecode || null, body.sunat_soap_error || resultado.error || null,
            body.enlace_del_pdf || body.enlace_pdf || body.enlace || null,
            body.enlace_del_xml || body.enlace_xml || null, body.enlace_del_cdr || body.enlace_cdr || null,
            body.cadena_para_codigo_qr || null, body.codigo_hash || null,
            JSON.stringify(respuestaPersistida), userContext.username, reserva.facturacion.id
        ];
        let facturacionActualizada;
        if (soportaFechaHora) {
            try {
                await client.query('SAVEPOINT sp_fact_fecha_hora');
                facturacionActualizada = await client.query(
                    `UPDATE fg_facturacion SET
                        estado = $1, aceptada_sunat = $2, sunat_description = $3, sunat_responsecode = $4,
                        sunat_soap_error = $5, enlace_pdf = $6, enlace_xml = $7, enlace_cdr = $8,
                        cadena_qr = $9, codigo_hash = $10, respuesta_proveedor = $11::jsonb,
                        fecha_hora_emision = COALESCE(fecha_hora_emision, now()),
                        fecha_aceptacion = CASE WHEN $2 THEN CURRENT_TIMESTAMP ELSE fecha_aceptacion END,
                        usuario_modificacion = $12, fecha_modificacion = CURRENT_TIMESTAMP
                     WHERE id = $13
                     RETURNING *`, paramsUpdate);
                await client.query('RELEASE SAVEPOINT sp_fact_fecha_hora');
            } catch (errHora) {
                if (errHora.code === '42703') {
                    await client.query('ROLLBACK TO SAVEPOINT sp_fact_fecha_hora');
                    facturacionActualizada = await client.query(
                        `UPDATE fg_facturacion SET
                            estado = $1, aceptada_sunat = $2, sunat_description = $3, sunat_responsecode = $4,
                            sunat_soap_error = $5, enlace_pdf = $6, enlace_xml = $7, enlace_cdr = $8,
                            cadena_qr = $9, codigo_hash = $10, respuesta_proveedor = $11::jsonb,
                            fecha_aceptacion = CASE WHEN $2 THEN CURRENT_TIMESTAMP ELSE fecha_aceptacion END,
                            usuario_modificacion = $12, fecha_modificacion = CURRENT_TIMESTAMP
                         WHERE id = $13
                         RETURNING *`, paramsUpdate);
                } else {
                    throw errHora;
                }
            }
        } else {
            facturacionActualizada = await client.query(
                `UPDATE fg_facturacion SET
                    estado = $1, aceptada_sunat = $2, sunat_description = $3, sunat_responsecode = $4,
                    sunat_soap_error = $5, enlace_pdf = $6, enlace_xml = $7, enlace_cdr = $8,
                    cadena_qr = $9, codigo_hash = $10, respuesta_proveedor = $11::jsonb,
                    fecha_aceptacion = CASE WHEN $2 THEN CURRENT_TIMESTAMP ELSE fecha_aceptacion END,
                    usuario_modificacion = $12, fecha_modificacion = CURRENT_TIMESTAMP
                 WHERE id = $13
                 RETURNING *`, paramsUpdate);
        }
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
        // La misma puerta que habilita la emisión del certificado decide el
        // postproceso. En PRODUCCIÓN exige aceptación SUNAT; en DEMO acepta el
        // comprobante generado por NubeFact con identidad y PDF/XML. Así el
        // chip se consume en el primer intento y no queda una factura válida
        // separada de su movimiento de inventario.
        if (esDocumentoBaseOperable(facturacionActualizada.rows[0]) && hooks.onDocumentoOperable) {
            await hooks.onDocumentoOperable(client);
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
        const error = errorNegocio(rechazada ? 'NUBEFACT_RECHAZADO' : 'NUBEFACT_ERROR', rechazada ? 422 : 502, {
            facturacion,
            motivo: body.sunat_description || body.errors || resultado.reason
        });
        if (diagnostico) error.diagnosticoContingencia = diagnostico;
        throw error;
    }
    return facturacion;
}

exports.emitirFacturacion = async (certificadoId, userContext, dependencies = {}, opciones = {}) => {
    const reserva = await reservarEmision(certificadoId, userContext, dependencies, opciones);
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
        diagnosticarContingencia: integrationsConfig.contingencia?.habilitada,
        onDocumentoOperable: async (client) => {
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
    const acceso = await validarAccesoPlanta(userContext.username, userContext.perfil_id, op.planta_key);
    if (!acceso) throw errorNegocio('PLANTA_NO_AUTORIZADA', 403);

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

exports.guardarFacturacionOperacion = async (operacionId, data, userContext, transaccion = null) => {
    const evaluacion = evaluarDatosFacturacion(data);
    if (evaluacion.errores.length > 0) throw errorNegocio('DATOS_FACTURACION_INVALIDOS', 400, evaluacion.errores);
    const normalizada = evaluacion.datos;

    const client = transaccion || await db.connect();
    try {
        if (!transaccion) await client.query('BEGIN');
        const opRes = await client.query('SELECT * FROM fg_operacion_comercial WHERE id=$1 FOR UPDATE', [operacionId]);
        if(!opRes.rowCount) throw errorNegocio('OPERACION_NOT_FOUND', 404);
        const op = opRes.rows[0];

        const ordenRes = await client.query('SELECT * FROM fg_orden_pago WHERE operacion_id = $1', [operacionId]);
        if(!ordenRes.rowCount) throw errorNegocio('ORDEN_PAGO_FALTANTE', 409);
        const orden = ordenRes.rows[0];

        if (normalizada.condicionPago === 'CREDITO') {
            await validarCreditoSinDescuentoActivo(client, orden.certificado_id);
        }

        if (normalizada.condicionPago === 'CONTADO' && (orden.estado !== 'PAGADO' || Number(orden.saldo_pendiente) > 0.009)) {
            throw errorNegocio('PAGO_INCOMPLETO', 409);
        }

        const totalCuotasEsperado = Number(orden.saldo_pendiente);
        if (normalizada.condicionPago === 'CREDITO') {
            if (totalCuotasEsperado <= 0.009) {
                throw errorNegocio('VENTA_CREDITO_SIN_SALDO', 409);
            }
            if (!validarCuotasContraTotal(normalizada.cuotas, totalCuotasEsperado)) {
                throw errorNegocio('CUOTAS_NO_COINCIDEN_CON_SALDO', 400, {
                    saldoPendiente: totalCuotasEsperado
                });
            }
        }

        const pagosPersistidos = await client.query(
            `SELECT p.tipocontado_key, p.tarjeta_key, p.modalidad_tarjeta, p.importe,
                    t.nombre AS tarjeta_nombre, ef.nombre AS entidad_nombre
             FROM fg_pago p
             LEFT JOIN tarjeta t ON t.key = p.tarjeta_key
             LEFT JOIN entidadfinanciera ef ON ef.key = p.entidadfinanciera_key
             WHERE p.orden_pago_id = $1 AND p.estado = 'CAN'
             ORDER BY p.id ASC`,
            [orden.id]
        );
        if (normalizada.condicionPago === 'CREDITO' && pagosPersistidos.rowCount > 0) {
            throw errorNegocio('CREDITO_CON_PAGOS_EXISTENTES', 409);
        }
        const medioPagoPersistido = derivarMedioPago(pagosPersistidos.rows);

        const actual = await client.query(
            'SELECT * FROM fg_facturacion WHERE operacion_id = $1 AND certificado_id IS NULL FOR UPDATE',
            [operacionId]
        );
        if (actual.rowCount > 0 && ['PENDIENTE', 'PENDIENTE_SUNAT', 'ACEPTADO', 'ERROR', 'RECHAZADO'].includes(actual.rows[0].estado)) {
            const cuotas = await client.query('SELECT * FROM fg_facturacion_cuota WHERE facturacion_id = $1 ORDER BY numero_cuota', [actual.rows[0].id]);
            if (!transaccion) await client.query('COMMIT');
            return respuestaPublica(actual.rows[0], cuotas.rows);
        }

        const result = await client.query(
            `INSERT INTO fg_facturacion (
                tipo_comprobante, tipo_documento_cliente, nro_documento,
                nombre_razon_social, direccion, email, telefono, moneda_key,
                base_imponible, igv, importe_total, condicion_pago,
                fecha_vencimiento, medio_pago, operacion_id, estado, usuario_creacion
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'BORRADOR',$16)
             ON CONFLICT (operacion_id) WHERE operacion_id IS NOT NULL DO UPDATE SET
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

        await sincronizarDetraccionFacturacion(client, result.rows[0].id, {
            tipoComprobante: normalizada.tipoComprobante,
            importeTotal: orden.importe_total,
            moneda: orden.moneda_key,
            operacionId
        });
        await client.query('DELETE FROM fg_facturacion_intento WHERE facturacion_id = $1', [result.rows[0].id]);
        await client.query('DELETE FROM fg_facturacion_cuota WHERE facturacion_id = $1', [result.rows[0].id]);
        for (const cuota of normalizada.cuotas) {
            await client.query(
                `INSERT INTO fg_facturacion_cuota
                    (facturacion_id, numero_cuota, fecha_pago, importe, estado)
                 VALUES ($1,$2,$3,$4,'PENDIENTE')`,
                [result.rows[0].id, cuota.numeroCuota, cuota.fechaPago, cuota.importe]
            );
        }
        await client.query(
            `UPDATE fg_orden_pago SET formapago_key = $2,
                    fecha_inicio_credito = $3, fecha_vencimiento_credito = $4,
                    fechmodi = CURRENT_TIMESTAMP, usuariomodi_username = $5 WHERE id = $1`,
            [
                orden.id,
                normalizada.condicionPago === 'CREDITO' ? 'credito' : 'contado',
                normalizada.condicionPago === 'CREDITO' ? normalizada.fechaInicioCredito : null,
                normalizada.condicionPago === 'CREDITO' ? normalizada.fechaVencimiento : null,
                userContext.username
            ]
        );
        result.rows[0].fecha_inicio_credito = normalizada.condicionPago === 'CREDITO'
            ? normalizada.fechaInicioCredito
            : null;
        const cuotasPersistidas = await client.query(
            'SELECT * FROM fg_facturacion_cuota WHERE facturacion_id = $1 ORDER BY numero_cuota',
            [result.rows[0].id]
        );
        if (!transaccion) await client.query('COMMIT');
        return respuestaPublica(result.rows[0], cuotasPersistidas.rows);
    } catch (error) {
        if (!transaccion) await client.query('ROLLBACK');
        throw error;
    } finally {
        if (!transaccion) client.release();
    }
};

const validarCodigosSunatOperacion = (detalles = []) => {
    const errores = [];
    for (const detalle of detalles) {
        if (!esCodigoClasificacionSunatValidoOpcional(detalle.codigo_sunat_snapshot)) {
            errores.push('El código de clasificación SUNAT del producto Chip debe contener 8 dígitos.');
        }
    }
    return errores;
};

const reservarEmisionOperacion = async (operacionId, userContext, opciones = {}, dependencies = {}) => {
    const proveedor = dependencies.nubefactService || nubefactService;
    if (!proveedor.obtenerEstadoConfiguracion().enabled) throw errorNegocio('NUBEFACT_DESHABILITADO', 503);
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const opRes = await client.query('SELECT * FROM fg_operacion_comercial WHERE id=$1 FOR UPDATE', [operacionId]);
        if(!opRes.rowCount) throw errorNegocio('OPERACION_NOT_FOUND', 404);
        const op = opRes.rows[0];
        if (userContext.perfil_id) {
            const acceso = await validarAccesoPlanta(userContext.username, userContext.perfil_id, op.planta_key);
            if (!acceso) throw errorNegocio('PLANTA_NO_AUTORIZADA', 403);
        }

        const factResult = await client.query('SELECT * FROM fg_facturacion WHERE operacion_id = $1 AND certificado_id IS NULL FOR UPDATE', [operacionId]);
        if (factResult.rowCount === 0) throw errorNegocio('FACTURACION_FALTANTE', 409);
        let facturacion = factResult.rows[0];

        if (['ACEPTADO', 'PENDIENTE_SUNAT'].includes(facturacion.estado) || Boolean(facturacion.codigo_hash && facturacion.enlace_pdf)) {
            if (facturacion.estado === 'BORRADOR' && Boolean(facturacion.codigo_hash && facturacion.enlace_pdf)) {
                const entornoFact = normalizarEntorno(facturacion.entorno_facturador || integrationsConfig.nubefact.environment);
                const nuevoEstado = entornoFact === 'DEMO' ? 'PENDIENTE_SUNAT' : facturacion.estado;
                if (nuevoEstado !== facturacion.estado) {
                    await client.query(
                        `UPDATE fg_facturacion SET estado = $1, usuario_modificacion = $2, fecha_modificacion = CURRENT_TIMESTAMP WHERE id = $3`,
                        [nuevoEstado, userContext.username, facturacion.id]
                    );
                    facturacion.estado = nuevoEstado;
                }
            }
            await client.query('COMMIT');
            return { yaAceptada: true, facturacion };
        }
        if (facturacion.estado === 'RECHAZADO') {
            if (esRechazoFiscalDefinitivo(facturacion)) {
                throw errorNegocio('NUBEFACT_RECHAZADO', 422, {
                    motivo: facturacion.sunat_description || 'El comprobante tiene un rechazo fiscal definitivo de SUNAT y requiere revisión operativa.'
                });
            }
            if (!opciones.reintentarRechazada && !esFalloTemporalProveedor(facturacion)) {
                throw errorNegocio('NUBEFACT_RECHAZADO', 422, { motivo: facturacion.sunat_description || 'El comprobante fue rechazado por Nubefact/SUNAT.' });
            }
            if (!facturacion.serie || facturacion.numero === null || !facturacion.nro_comprobante) {
                throw errorNegocio('REINTENTO_CORRELATIVO_INVALIDO', 409, {
                    motivo: 'La facturación rechazada no tiene serie y número persistidos; no se puede reintentar sin reservar otro correlativo.'
                });
            }
        }

        const configuracionEmisor = await nubefactConfigService.resolverParaPlanta(op.planta_key, client);
        const erroresContrato = validarFacturacionNubefact(facturacion);

        // Block if SKU is missing
        const detallesOp = await client.query('SELECT codigo_sunat_snapshot FROM fg_operacion_detalle WHERE operacion_id=$1', [operacionId]);
        erroresContrato.push(...validarCodigosSunatOperacion(detallesOp.rows));

        const resumenTributario = await resumenTributarioService.obtenerResumenTributarioPorOperacion(operacionId, client);
        if (resumenTributario.estado !== 'LISTO') erroresContrato.push(...resumenTributario.errores);
        if (erroresContrato.length > 0) throw errorNegocio('DATOS_NUBEFACT_INVALIDOS', 409, erroresContrato);
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
        let correlativoVerificadoEnNubeFact = false;
        if (!facturacion.serie || facturacion.numero === null) {
            if (!integrationsConfig.nubefact.correlativosV2Enabled) {
                throw errorNegocio('MOTOR_SERIES_V2_DESHABILITADO', 503, 'El motor de series legacy fue retirado. Habilite V2.');
            }
            const argumentosCorrelativo = {
                plantaKey: op.planta_key,
                empresaKey: configuracionEmisor.empresaKey,
                tipoComprobante: facturacion.tipo_comprobante,
                environment: configuracionEmisor.environment
            };
            const reservaCorrelativo = ['FACTURA', 'BOLETA'].includes(facturacion.tipo_comprobante)
                ? await correlativosNubefactService.reservarSiguienteDisponible({
                    ...argumentosCorrelativo,
                    provider: proveedor,
                    credentials: configuracionEmisor.credentials
                }, client)
                : await correlativosNubefactService.reservarSiguiente(argumentosCorrelativo, client);
            facturacion.serie = reservaCorrelativo.serie;
            facturacion.numero = reservaCorrelativo.numero;
            facturacion.nro_comprobante = reservaCorrelativo.nroComprobante;
            facturacion.serie_comprobante_id = reservaCorrelativo.id;
            correlativoVerificadoEnNubeFact = reservaCorrelativo.disponibleEnNubefact === true;
        }

        if (!correlativoVerificadoEnNubeFact) {
            if (typeof proveedor?.consultarComprobante === 'function' && facturacion.serie && facturacion.numero !== null) {
                const consultaPrevia = await proveedor.consultarComprobante({
                    tipoDeComprobante: facturacion.tipo_comprobante === 'FACTURA' ? 1 : 2,
                    serie: facturacion.serie,
                    numero: facturacion.numero
                }, { credentials: configuracionEmisor.credentials });

                if (['ACCEPTED', 'PENDING_SUNAT'].includes(consultaPrevia?.status)) {
                    const datosConsulta = consultaPrevia.data || {};
                    const nuevoEstado = consultaPrevia.status === 'ACCEPTED' ? 'ACEPTADO' : 'PENDIENTE_SUNAT';
                    await client.query(
                        `UPDATE fg_facturacion SET
                            estado = $1, aceptada_sunat = $2, sunat_description = $3,
                            enlace_pdf = COALESCE($4, enlace_pdf), enlace_xml = COALESCE($5, enlace_xml),
                            enlace_cdr = COALESCE($6, enlace_cdr), codigo_hash = COALESCE($7, codigo_hash),
                            respuesta_proveedor = $8::jsonb, usuario_modificacion = $9, fecha_modificacion = CURRENT_TIMESTAMP
                         WHERE id = $10`,
                        [
                            nuevoEstado,
                            consultaPrevia.status === 'ACCEPTED',
                            datosConsulta.sunat_description || null,
                            datosConsulta.enlace_del_pdf || datosConsulta.enlace_pdf || null,
                            datosConsulta.enlace_del_xml || datosConsulta.enlace_xml || null,
                            datosConsulta.enlace_del_cdr || datosConsulta.enlace_cdr || null,
                            datosConsulta.codigo_hash || null,
                            JSON.stringify(consultaPrevia),
                            userContext.username,
                            facturacion.id
                        ]
                    );
                    const updatedFact = await client.query('SELECT * FROM fg_facturacion WHERE id = $1', [facturacion.id]);
                    await client.query('COMMIT');
                    return { yaAceptada: true, facturacion: updatedFact.rows[0] };
                }
            }

            await validarCorrelativoDisponible(proveedor, {
                tipoComprobante: facturacion.tipo_comprobante,
                serie: facturacion.serie,
                numero: facturacion.numero,
                credentials: configuracionEmisor.credentials
            });
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
                usuario_modificacion = $12, fecha_modificacion = CURRENT_TIMESTAMP,
                serie_comprobante_id = $13, fecha_reserva_correlativo = CURRENT_TIMESTAMP
             WHERE id = $14 RETURNING *`,
            [
                facturacion.serie, facturacion.numero, facturacion.nro_comprobante, intento,
                op.planta_key, configuracionEmisor.empresaKey, configuracionEmisor.rucEmisor,
                configuracionEmisor.razonSocialEmisor, configuracionEmisor.direccionEmisor,
                configuracionEmisor.environment, codigoUnico, userContext.username,
                facturacion.serie_comprobante_id, facturacion.id
            ]
        );
        facturacion = updated.rows[0];
        const evalSpotOp = await sincronizarDetraccionFacturacion(client, facturacion.id, {
            tipoComprobante: facturacion.tipo_comprobante,
            importeTotal: facturacion.importe_total,
            moneda: facturacion.moneda_key,
            items: detallesNubefact,
            operacionId
        });
        if (evalSpotOp) Object.assign(facturacion, {
            sujeto_detraccion: evalSpotOp.sujeto,
            detraccion_codigo: evalSpotOp.codigo,
            detraccion_descripcion: evalSpotOp.descripcion,
            detraccion_porcentaje: evalSpotOp.porcentaje,
            detraccion_base: evalSpotOp.base,
            detraccion_monto: evalSpotOp.monto,
            detraccion_neto: evalSpotOp.neto,
            detraccion_estado_deposito: evalSpotOp.estadoDeposito,
            detraccion_motivo_exclusion: evalSpotOp.motivoExclusion
        });
        validarCuentaDetraccionEmisor(evalSpotOp, configuracionEmisor);

        const cuotasResult = await client.query(
            'SELECT * FROM fg_facturacion_cuota WHERE facturacion_id = $1 ORDER BY numero_cuota',
            [facturacion.id]
        );
        if (facturacion.condicion_pago === 'CREDITO') {
            const ordenRes = await client.query('SELECT * FROM fg_orden_pago WHERE operacion_id = $1', [operacionId]);
            if (!ordenRes.rowCount) throw errorNegocio('ORDEN_PAGO_FALTANTE', 409);
            const orden = ordenRes.rows[0];
            await validarCreditoSinDescuentoActivo(client, orden.certificado_id);
            if (!validarCuotasContraTotal(cuotasResult.rows, orden.saldo_pendiente)) {
                throw errorNegocio('CUOTAS_NO_COINCIDEN_CON_SALDO', 409);
            }
        }

        const payload = construirPayloadNubefact({
            facturacion,
            certificado: null,
            vehiculo: { placa: '' },
            reservaDescuento: null,
            detalles: detallesNubefact,
            resumenTributario,
            cuotas: cuotasResult.rows
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

const ejecutarEmisionOperacion = async (reserva, userContext, dependencies = {}) => {
    if (reserva.yaAceptada) return respuestaPublica(reserva.facturacion);

    const proveedor = dependencies.nubefactService || nubefactService;
    const resultadoEmision = await proveedor.emitirComprobante(
        reserva.payload,
        { credentials: reserva.credentials }
    );
    const recuperacion = await consultarEmisionIncierta(proveedor, reserva, resultadoEmision);

    return await persistirRespuestaNubeFact(reserva, resultadoEmision, recuperacion, userContext);
};

exports.emitirFacturacionOperacion = async (operacionId, userContext, dependencies = {}) => {
    const reserva = await reservarEmisionOperacion(operacionId, userContext, {}, dependencies);
    return ejecutarEmisionOperacion(reserva, userContext, dependencies);
};

exports.reintentarFacturacionOperacion = async (operacionId, userContext, dependencies = {}) => {
    const reserva = await reservarEmisionOperacion(operacionId, userContext, {
        reintentarRechazada: true
    }, dependencies);
    return ejecutarEmisionOperacion(reserva, userContext, dependencies);
};

exports._private = {
    respuestaPublica,
    errorNegocio,
    esPosibleDuplicadoNubefact,
    consultarEmisionIncierta,
    validarCodigosSunatOperacion,
    sincronizarDetraccionFacturacion,
    validarCuentaDetraccionEmisor,
    validarCreditoSinDescuentoActivo,
    esFalloTemporalProveedor,
    esRechazoFiscalDefinitivo,
    reservarEmision
};


