const db = require('../../../config/database');
const nubefactService = require('../../../services/integrations/nubefact.service');
const nubefactConfigService = require('./faregas-nubefact-config.service');
const integrationsConfig = require('../../../config/integrations.config');

const OPERACION_CONSULTA = 'consultar_comprobante';
const ESTADOS_RECONCILIABLES = ['PENDIENTE', 'PENDIENTE_SUNAT'];

const resumenVacio = () => ({
    procesados: 0,
    aceptados: 0,
    rechazados: 0,
    pendientes: 0,
    errores: 0,
    omitidos: 0
});

const normalizarEntorno = (valor) => {
    const entorno = String(valor || '').trim().toUpperCase();
    return entorno === 'PRODUCTION' ? 'PRODUCCION' : entorno;
};

const enteroPositivo = (valor, predeterminado) => {
    const numero = Number(valor);
    return Number.isInteger(numero) && numero > 0 ? numero : predeterminado;
};

const convertirATexto = (valor) => {
    if (valor === undefined || valor === null || valor === '') return '';
    if (typeof valor === 'string') return valor;
    try { return JSON.stringify(valor); } catch (_) { return String(valor); }
};

const textoProveedor = (resultado) => {
    const data = resultado?.data || {};
    return [
        data.errors,
        data.error,
        data.sunat_description,
        data.mensaje,
        data.message,
        resultado?.reason,
        resultado?.error
    ].map(convertirATexto)
        .filter(Boolean)
        .join(' | ');
};

const esDocumentoNoEncontrado = (resultado) => {
    const mensaje = textoProveedor(resultado).toLowerCase();
    return mensaje.includes('documento no existe')
        || mensaje.includes('documento inexistente')
        || mensaje.includes('no se encontro el documento')
        || mensaje.includes('no se encontró el documento')
        || mensaje.includes('comprobante no existe');
};

const reclamarLote = async ({
    database,
    entorno,
    batchSize,
    pendingLeaseMs,
    reconciliationRetryMs,
    maxErrors
}) => {
    const client = await database.connect();
    try {
        await client.query('BEGIN');

        // Los intentos de consulta tienen su propio límite; no alteran el contador
        // de POST de emisión almacenado en fg_facturacion.intentos.
        await client.query(`
            UPDATE fg_facturacion f
               SET estado = 'ERROR',
                   sunat_soap_error = COALESCE(sunat_soap_error, 'MAX_RECONCILIATION_ERRORS'),
                   fecha_modificacion = CURRENT_TIMESTAMP
             WHERE f.entorno_facturador = $1
               AND f.estado IN ('PENDIENTE', 'PENDIENTE_SUNAT')
               AND (
                    SELECT COUNT(*)
                      FROM fg_facturacion_intento i
                     WHERE i.facturacion_id = f.id
                       AND i.estado = 'ERROR'
                       AND i.solicitud ->> 'operacion' = $2
               ) >= $3
        `, [entorno, OPERACION_CONSULTA, maxErrors]);

        const pendientes = await client.query(`
            SELECT f.id AS facturacion_id,
                   f.certificado_id,
                   f.estado,
                   f.serie,
                   f.numero,
                   f.tipo_comprobante,
                   f.operacion_id,
                   c.planta_key
              FROM fg_facturacion f
              JOIN fg_certificado c ON c.id = f.certificado_id
             WHERE f.entorno_facturador = $1
               AND f.estado IN ('PENDIENTE', 'PENDIENTE_SUNAT')
               AND (
                    (f.estado = 'PENDIENTE'
                     AND COALESCE(f.fecha_ultimo_intento, f.fecha_modificacion, f.fecha_creacion)
                         <= CURRENT_TIMESTAMP - ($2 * INTERVAL '1 millisecond'))
                 OR (f.estado = 'PENDIENTE_SUNAT'
                     AND COALESCE(f.fecha_ultimo_intento, f.fecha_modificacion, f.fecha_creacion)
                         <= CURRENT_TIMESTAMP - ($3 * INTERVAL '1 millisecond'))
               )
               AND (
                    SELECT COUNT(*)
                      FROM fg_facturacion_intento i
                     WHERE i.facturacion_id = f.id
                       AND i.estado = 'ERROR'
                       AND i.solicitud ->> 'operacion' = $4
               ) < $5
             ORDER BY COALESCE(f.fecha_ultimo_intento, f.fecha_modificacion, f.fecha_creacion), f.id
             LIMIT $6
             FOR UPDATE OF f SKIP LOCKED
        `, [
            entorno,
            pendingLeaseMs,
            reconciliationRetryMs,
            OPERACION_CONSULTA,
            maxErrors,
            batchSize
        ]);

        const reclamadas = [];
        for (const fila of pendientes.rows) {
            const numeroIntento = await client.query(`
                SELECT COALESCE(MAX(numero_intento), 0) + 1 AS numero
                  FROM fg_facturacion_intento
                 WHERE facturacion_id = $1
            `, [fila.facturacion_id]);
            const solicitud = {
                operacion: OPERACION_CONSULTA,
                origen: 'CRON_RECONCILIACION',
                estado_reclamado: fila.estado
            };
            const claim = await client.query(`
                INSERT INTO fg_facturacion_intento
                    (facturacion_id, numero_intento, estado, solicitud)
                VALUES ($1, $2, 'PENDIENTE', $3::jsonb)
                RETURNING id
            `, [
                fila.facturacion_id,
                Number(numeroIntento.rows[0].numero),
                JSON.stringify(solicitud)
            ]);
            await client.query(`
                UPDATE fg_facturacion
                   SET fecha_ultimo_intento = CURRENT_TIMESTAMP,
                       fecha_modificacion = CURRENT_TIMESTAMP
                 WHERE id = $1 AND estado = $2
            `, [fila.facturacion_id, fila.estado]);
            reclamadas.push({
                ...fila,
                claim_id: claim.rows[0].id,
                claim_numero: Number(numeroIntento.rows[0].numero)
            });
        }

        await client.query('COMMIT');
        return reclamadas;
    } catch (error) {
        try { await client.query('ROLLBACK'); } catch (_) { /* sin acción */ }
        throw error;
    } finally {
        client.release();
    }
};

const consultarFila = async (fila, { provider, configService }) => {
    const configuracion = await configService.resolverParaPlanta(fila.planta_key);
    return provider.consultarComprobante({
        tipoDeComprobante: fila.tipo_comprobante === 'FACTURA' ? 1 : 2,
        serie: fila.serie,
        numero: fila.numero
    }, { credentials: configuracion.credentials });
};

const persistirResultado = async ({ database, fila, resultado, maxErrors }) => {
    const client = await database.connect();
    const data = resultado?.data || {};
    const respuesta = data && typeof data === 'object' ? data : { valor: data };
    const status = String(resultado?.status || 'ERROR').toUpperCase();
    const mensaje = textoProveedor(resultado) || null;

    try {
        await client.query('BEGIN');
        const vigente = await client.query(`
            SELECT f.estado
              FROM fg_facturacion f
             WHERE f.id = $1
               AND f.estado IN ('PENDIENTE', 'PENDIENTE_SUNAT')
               AND EXISTS (
                    SELECT 1
                      FROM fg_facturacion_intento claim
                     WHERE claim.id = $2
                       AND claim.facturacion_id = f.id
                       AND claim.solicitud ->> 'operacion' = $3
               )
               AND NOT EXISTS (
                    SELECT 1
                      FROM fg_facturacion_intento posterior
                     WHERE posterior.facturacion_id = f.id
                       AND posterior.id > $2
               )
             FOR UPDATE OF f
        `, [fila.facturacion_id, fila.claim_id, OPERACION_CONSULTA]);

        if (vigente.rowCount === 0) {
            await client.query(`
                UPDATE fg_facturacion_intento
                   SET respuesta = $2::jsonb,
                       error = 'STALE_RESULT_IGNORED',
                       fecha_finalizacion = CURRENT_TIMESTAMP
                 WHERE id = $1
            `, [fila.claim_id, JSON.stringify(respuesta)]);
            await client.query('COMMIT');
            return { actualizada: false, estado: 'OMITIDO' };
        }

        let nuevoEstado;
        let estadoIntento;
        if (status === 'ACCEPTED') {
            nuevoEstado = 'ACEPTADO';
            estadoIntento = 'ACEPTADO';
            await client.query(`
                UPDATE fg_facturacion
                   SET estado = 'ACEPTADO',
                       aceptada_sunat = TRUE,
                       fecha_aceptacion = CURRENT_TIMESTAMP,
                       enlace_pdf = COALESCE($2, enlace_pdf),
                       enlace_xml = COALESCE($3, enlace_xml),
                       enlace_cdr = COALESCE($4, enlace_cdr),
                       cadena_qr = COALESCE($5, cadena_qr),
                       codigo_hash = COALESCE($6, codigo_hash),
                       sunat_responsecode = COALESCE($7, sunat_responsecode),
                       sunat_description = COALESCE($8, sunat_description),
                       sunat_soap_error = NULL,
                       respuesta_proveedor = $9::jsonb,
                       fecha_modificacion = CURRENT_TIMESTAMP
                 WHERE id = $1
            `, [
                fila.facturacion_id,
                data.enlace_del_pdf || data.enlace_pdf || data.enlace || null,
                data.enlace_del_xml || data.enlace_xml || null,
                data.enlace_del_cdr || data.enlace_cdr || null,
                data.cadena_para_codigo_qr || data.cadena_qr || null,
                data.codigo_hash || null,
                data.sunat_responsecode || null,
                data.sunat_description || null,
                JSON.stringify(respuesta)
            ]);
        } else if (status === 'REJECTED' && !esDocumentoNoEncontrado(resultado)) {
            nuevoEstado = 'RECHAZADO';
            estadoIntento = 'RECHAZADO';
            await client.query(`
                UPDATE fg_facturacion
                   SET estado = 'RECHAZADO',
                       aceptada_sunat = FALSE,
                       sunat_description = COALESCE($2, sunat_description),
                       sunat_responsecode = COALESCE($3, sunat_responsecode),
                       respuesta_proveedor = $4::jsonb,
                       fecha_modificacion = CURRENT_TIMESTAMP
                 WHERE id = $1
            `, [
                fila.facturacion_id,
                data.sunat_description || data.errors || mensaje || 'Rechazado por SUNAT',
                data.sunat_responsecode || null,
                JSON.stringify(respuesta)
            ]);
        } else if (status === 'PENDING_SUNAT' || esDocumentoNoEncontrado(resultado)) {
            // Un PENDIENTE huérfano es emisión incierta. Si la consulta no encuentra
            // el documento, nunca se realiza otro POST automáticamente.
            nuevoEstado = 'PENDIENTE_SUNAT';
            estadoIntento = 'PENDIENTE';
            await client.query(`
                UPDATE fg_facturacion
                   SET estado = 'PENDIENTE_SUNAT',
                       sunat_description = COALESCE($2, sunat_description),
                       respuesta_proveedor = $3::jsonb,
                       fecha_modificacion = CURRENT_TIMESTAMP
                 WHERE id = $1
            `, [fila.facturacion_id, mensaje, JSON.stringify(respuesta)]);
        } else {
            const erroresPrevios = await client.query(`
                SELECT COUNT(*)::integer AS total
                  FROM fg_facturacion_intento
                 WHERE facturacion_id = $1
                   AND estado = 'ERROR'
                   AND solicitud ->> 'operacion' = $2
            `, [fila.facturacion_id, OPERACION_CONSULTA]);
            const totalErrores = Number(erroresPrevios.rows[0].total || 0) + 1;
            nuevoEstado = totalErrores >= maxErrors ? 'ERROR' : 'PENDIENTE_SUNAT';
            estadoIntento = 'ERROR';
            await client.query(`
                UPDATE fg_facturacion
                   SET estado = $2,
                       sunat_soap_error = $3,
                       respuesta_proveedor = $4::jsonb,
                       fecha_modificacion = CURRENT_TIMESTAMP
                 WHERE id = $1
            `, [
                fila.facturacion_id,
                nuevoEstado,
                mensaje || 'ERROR_TECNICO_RECONCILIACION',
                JSON.stringify(respuesta)
            ]);
        }

        await client.query(`
            UPDATE fg_facturacion_intento
               SET estado = $2,
                   respuesta = $3::jsonb,
                   http_status = $4,
                   error = $5,
                   fecha_finalizacion = CURRENT_TIMESTAMP
             WHERE id = $1
        `, [
            fila.claim_id,
            estadoIntento,
            JSON.stringify(respuesta),
            resultado?.httpStatus || null,
            estadoIntento === 'ERROR' ? (mensaje || 'ERROR_TECNICO_RECONCILIACION') : null
        ]);

        if (nuevoEstado === 'ACEPTADO' && fila.operacion_id) {
            await client.query(`
                UPDATE fg_operacion_comercial
                   SET estado = 'FACTURADO', fecha_modificacion = CURRENT_TIMESTAMP
                 WHERE id = $1
            `, [fila.operacion_id]);
        }

        await client.query('COMMIT');
        return { actualizada: true, estado: nuevoEstado };
    } catch (error) {
        try { await client.query('ROLLBACK'); } catch (_) { /* sin acción */ }
        throw error;
    } finally {
        client.release();
    }
};

const reconciliarPendientesSunat = async (opciones = {}) => {
    const database = opciones.database || db;
    const provider = opciones.provider || nubefactService;
    const configService = opciones.configService || nubefactConfigService;
    const config = opciones.integrationsConfig || integrationsConfig;
    const logger = opciones.logger || console;
    const entorno = normalizarEntorno(opciones.environment || config.nubefact.environment);
    const resumen = resumenVacio();

    if (!['DEMO', 'PRODUCCION'].includes(entorno) || config.nubefact.enabled === false) {
        return resumen;
    }

    const batchSize = enteroPositivo(opciones.batchSize, 50);
    const pendingLeaseMs = Math.max(60_000, enteroPositivo(
        opciones.pendingLeaseMs,
        config.nubefact.retryLockMs
    ));
    const reconciliationRetryMs = Math.max(60_000, enteroPositivo(
        opciones.reconciliationRetryMs,
        config.nubefact.reconciliationRetryMs
    ));
    const maxErrors = enteroPositivo(opciones.maxErrors, config.nubefact.maxAttempts);

    let filas;
    try {
        filas = await reclamarLote({
            database,
            entorno,
            batchSize,
            pendingLeaseMs,
            reconciliationRetryMs,
            maxErrors
        });
    } catch (error) {
        logger.error('[CRON NUBEFACT] No se pudo reclamar el lote:', error.message);
        resumen.errores += 1;
        return resumen;
    }

    for (const fila of filas) {
        resumen.procesados += 1;
        let resultado;
        try {
            resultado = await consultarFila(fila, { provider, configService });
        } catch (error) {
            resultado = {
                status: 'ERROR',
                reason: 'RECONCILIATION_EXCEPTION',
                error: error.message,
                data: null
            };
        }

        try {
            const persistencia = await persistirResultado({ database, fila, resultado, maxErrors });
            if (!persistencia.actualizada) resumen.omitidos += 1;
            else if (persistencia.estado === 'ACEPTADO') resumen.aceptados += 1;
            else if (persistencia.estado === 'RECHAZADO') resumen.rechazados += 1;
            else if (persistencia.estado === 'PENDIENTE_SUNAT') resumen.pendientes += 1;
            else if (persistencia.estado === 'ERROR') resumen.errores += 1;
        } catch (error) {
            logger.error(
                `[CRON NUBEFACT] No se pudo persistir facturación ${fila.facturacion_id}:`,
                error.message
            );
            resumen.errores += 1;
        }
    }

    return resumen;
};

module.exports = {
    reconciliarPendientesSunat,
    _private: {
        OPERACION_CONSULTA,
        ESTADOS_RECONCILIABLES,
        resumenVacio,
        normalizarEntorno,
        esDocumentoNoEncontrado,
        reclamarLote,
        consultarFila,
        persistirResultado
    }
};
