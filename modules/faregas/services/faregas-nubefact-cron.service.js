const db = require('../../../config/database');
const nubefactService = require('../../../services/integrations/nubefact.service');
const nubefactConfigService = require('./faregas-nubefact-config.service');
const integrationsConfig = require('../../../config/integrations.config');

const reconciliarPendientesSunat = async (opciones = {}) => {
    const batchSize = opciones.batchSize || 50;
    const entorno = String(integrationsConfig.nubefact.environment || '').trim().toUpperCase();
    
    if (!['DEMO', 'PRODUCCION', 'PRODUCTION'].includes(entorno)) {
        return { procesados: 0, aceptados: 0, rechazados: 0 };
    }

    const client = await db.connect();
    let procesados = 0;
    let aceptados = 0;
    let rechazados = 0;

    let pendientesRows = [];

    try {
        await client.query('BEGIN');

        const query = `
            SELECT f.id as facturacion_id, f.certificado_id, f.estado, f.serie, f.numero, f.tipo_comprobante, f.operacion_id,
                   c.planta_key
            FROM fg_facturacion f
            JOIN fg_certificado c ON f.certificado_id = c.id
            WHERE f.estado = 'PENDIENTE_SUNAT'
                AND f.entorno_facturador = $1
                AND (f.fecha_ultimo_intento IS NULL OR f.fecha_ultimo_intento < CURRENT_TIMESTAMP - INTERVAL '15 minutes')
            ORDER BY f.fecha_modificacion ASC
            LIMIT $2
            FOR UPDATE OF f SKIP LOCKED
        `;
        
        const pendientes = await client.query(query, [entorno, batchSize]);
        pendientesRows = pendientes.rows;

        if (pendientesRows.length > 0) {
            const ids = pendientesRows.map(r => r.facturacion_id);
            await client.query(`
                UPDATE fg_facturacion 
                SET fecha_ultimo_intento = CURRENT_TIMESTAMP, 
                    intentos = COALESCE(intentos, 0) + 1,
                    fecha_modificacion = CURRENT_TIMESTAMP 
                WHERE id = ANY($1)
            `, [ids]);
        }
        await client.query('COMMIT'); 
    } catch (err) {
        try { await client.query('ROLLBACK'); } catch (e) { }
        console.error('[CRON NUBEFACT] Error seleccionando lote:', err.message);
        client.release();
        return { procesados, aceptados, rechazados };
    }

    // Fuera de la transaccion de seleccion
    for (const fila of pendientesRows) {
        procesados++;
        try {
            const conf = await nubefactConfigService.resolverParaPlanta(fila.planta_key);
            // Reemplazo: ya no usamos conf.credentials.ambiente (que a veces era indefinido), 
            // conf.environment fue validado en resolverParaPlanta y coincide con la intencion.
            // La BD ya filtra por entorno_facturador, asumiendo coherencia.

            const consulta = await nubefactService.consultarComprobante({
                tipoDeComprobante: fila.tipo_comprobante === 'FACTURA' ? 1 : 2,
                serie: fila.serie,
                numero: fila.numero
            }, { credentials: conf.credentials });
            
            if (consulta.status === 'ACCEPTED') {
                await client.query('BEGIN');
                await client.query(`
                    UPDATE fg_facturacion 
                    SET estado = 'ACEPTADO',
                        aceptada_sunat = TRUE,
                        fecha_aceptacion = CURRENT_TIMESTAMP,
                        sunat_ticket_numero = COALESCE($2, sunat_ticket_numero),
                        enlace_pdf = COALESCE($3, enlace_pdf),
                        enlace_xml = COALESCE($4, enlace_xml),
                        enlace_cdr = COALESCE($5, enlace_cdr),
                        cadena_qr = COALESCE($6, cadena_qr),
                        codigo_hash = COALESCE($7, codigo_hash),
                        sunat_responsecode = COALESCE($8, sunat_responsecode),
                        respuesta_proveedor = $9,
                        fecha_modificacion = CURRENT_TIMESTAMP
                    WHERE id = $1
                `, [
                    fila.facturacion_id,
                    consulta.data?.sunat_ticket_numero || null,
                    consulta.data?.enlace_del_pdf || null,
                    consulta.data?.enlace_del_xml || null,
                    consulta.data?.enlace_del_cdr || null,
                    consulta.data?.cadena_para_codigo_qr || null,
                    consulta.data?.codigo_hash || null,
                    consulta.data?.sunat_responsecode || null,
                    JSON.stringify(consulta.data)
                ]);
                
                if (fila.operacion_id) {
                    await client.query(`
                        UPDATE fg_operacion_comercial 
                        SET estado = 'FACTURADO', fecha_modificacion = CURRENT_TIMESTAMP 
                        WHERE id = $1
                    `, [fila.operacion_id]);
                }
                await client.query('COMMIT');
                aceptados++;
            } else if (consulta.status === 'REJECTED') {
                await client.query(`
                    UPDATE fg_facturacion 
                    SET estado = 'RECHAZADO', 
                        sunat_description = COALESCE($2, sunat_description),
                        sunat_responsecode = COALESCE($3, sunat_responsecode),
                        respuesta_proveedor = $4,
                        fecha_modificacion = CURRENT_TIMESTAMP
                    WHERE id = $1
                `, [
                    fila.facturacion_id,
                    consulta.data?.sunat_description || consulta.data?.errors || 'Rechazado por SUNAT',
                    consulta.data?.sunat_responsecode || null,
                    JSON.stringify(consulta.data)
                ]);
                rechazados++;
            }
        } catch (err) {
            console.error(`[CRON NUBEFACT] Error reconciliando facturacion ${fila.facturacion_id}:`, err.message);
        }
    }
    
    client.release();
    return { procesados, aceptados, rechazados };
};

module.exports = { reconciliarPendientesSunat };
