const db = require('../../../config/database');
const documentosService = require('./faregas-documentos-electronicos.service');
const integrationsConfig = require('../../../config/integrations.config');

const normalizarEntorno = (valor) => {
    const entorno = String(valor || '').trim().toUpperCase();
    return entorno === 'PRODUCTION' ? 'PRODUCCION' : entorno;
};

const crearReconciliadorNotas = ({
    database = db,
    documentos = documentosService,
    config = integrationsConfig,
    logger = console
} = {}) => async (opciones = {}) => {
    const batchSize = Math.min(200, Math.max(1, Number(opciones.batchSize) || 50));
    const entorno = normalizarEntorno(config.nubefact?.environment);
    if (!['DEMO', 'PRODUCCION'].includes(entorno)) {
        return { procesados: 0, aceptados: 0, rechazados: 0, pendientes: 0, errores: 0 };
    }

    const client = await database.connect();
    let filas = [];
    try {
        await client.query('BEGIN');
        const pendientes = await client.query(`
            SELECT n.id AS nota_id
            FROM fg_credito n
            JOIN fg_facturacion f ON f.id = n.facturacion_id
            WHERE n.estado = 'PENDIENTE'
              AND f.entorno_facturador = $1
              AND (n.fecha_ultimo_intento IS NULL
                   OR n.fecha_ultimo_intento < CURRENT_TIMESTAMP - INTERVAL '15 minutes')
            ORDER BY COALESCE(n.fecha_modificacion, n.fecha_creacion), n.id
            LIMIT $2
            FOR UPDATE OF n SKIP LOCKED
        `, [entorno, batchSize]);
        filas = pendientes.rows;
        if (filas.length > 0) {
            await client.query(`
                UPDATE fg_credito
                SET fecha_ultimo_intento = CURRENT_TIMESTAMP,
                    fecha_modificacion = CURRENT_TIMESTAMP
                WHERE id = ANY($1::bigint[])
            `, [filas.map((fila) => Number(fila.nota_id))]);
        }
        await client.query('COMMIT');
    } catch (error) {
        try { await client.query('ROLLBACK'); } catch (_rollbackError) { /* sin acción */ }
        logger.error('[CRON NUBEFACT] Error seleccionando notas pendientes:', error.message);
        return { procesados: 0, aceptados: 0, rechazados: 0, pendientes: 0, errores: 1 };
    } finally {
        client.release();
    }

    const resumen = { procesados: 0, aceptados: 0, rechazados: 0, pendientes: 0, errores: 0 };
    for (const fila of filas) {
        resumen.procesados++;
        try {
            const nota = await documentos.reconciliarNotaPendiente(Number(fila.nota_id), opciones.dependencies || {});
            if (nota.estado === 'ACEPTADO') resumen.aceptados++;
            else if (nota.estado === 'RECHAZADO') resumen.rechazados++;
            else resumen.pendientes++;
        } catch (error) {
            resumen.errores++;
            logger.error(`[CRON NUBEFACT] Error consultando nota ${fila.nota_id}:`, error.message);
        }
    }
    return resumen;
};

const reconciliarNotasPendientesSunat = crearReconciliadorNotas();

module.exports = {
    reconciliarNotasPendientesSunat,
    _private: { crearReconciliadorNotas, normalizarEntorno }
};
