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

    try {
        await client.query('BEGIN');

        const query = `
            SELECT f.id as facturacion_id, f.certificado_id, f.estado, f.serie, f.numero, f.tipo_comprobante,
                   c.planta_key
            FROM fg_facturacion f
            JOIN fg_certificado c ON f.certificado_id = c.id
            WHERE f.estado = 'PENDIENTE_SUNAT'
            ORDER BY f.fecha_modificacion ASC
            LIMIT $1
            FOR UPDATE OF f SKIP LOCKED
        `;
        
        const pendientes = await client.query(query, [batchSize]);

        if (pendientes.rowCount > 0) {
            const ids = pendientes.rows.map(r => r.facturacion_id);
            await client.query(`UPDATE fg_facturacion SET fecha_modificacion = CURRENT_TIMESTAMP WHERE id = ANY($1)`, [ids]);
        }
        await client.query('COMMIT'); 

        for (const fila of pendientes.rows) {
            procesados++;
            try {
                const conf = await nubefactConfigService.resolverParaPlanta(fila.planta_key);
                if (String(conf.credentials.ambiente).toUpperCase() !== entorno) {
                    continue; 
                }

                const consulta = await nubefactService.consultarComprobante({
                    tipoDeComprobante: fila.tipo_comprobante === 'FACTURA' ? 1 : 2,
                    serie: fila.serie,
                    numero: fila.numero
                }, { credentials: conf.credentials });
                
                if (consulta.status === 'ACCEPTED') {
                    await db.query(`
                        UPDATE fg_facturacion 
                        SET estado = 'ACEPTADO',
                            aceptada_sunat = TRUE,
                            fecha_aceptacion = COALESCE($2, fecha_aceptacion),
                            sunat_ticket_numero = COALESCE($3, sunat_ticket_numero),
                            enlace_pdf = COALESCE($4, enlace_pdf),
                            enlace_xml = COALESCE($5, enlace_xml),
                            enlace_cdr = COALESCE($6, enlace_cdr),
                            cadena_qr = COALESCE($7, cadena_qr),
                            codigo_hash = COALESCE($8, codigo_hash),
                            sunat_responsecode = COALESCE($9, sunat_responsecode),
                            fecha_modificacion = CURRENT_TIMESTAMP
                        WHERE id = $1
                    `, [
                        fila.facturacion_id,
                        consulta.data?.fecha_de_emision || null,
                        consulta.data?.sunat_ticket_numero || null,
                        consulta.data?.enlace_del_pdf || null,
                        consulta.data?.enlace_del_xml || null,
                        consulta.data?.enlace_del_cdr || null,
                        consulta.data?.cadena_para_codigo_qr || null,
                        consulta.data?.codigo_hash || null,
                        consulta.data?.sunat_responsecode || null
                    ]);
                    aceptados++;
                } else if (consulta.status === 'REJECTED') {
                    await db.query(`
                        UPDATE fg_facturacion 
                        SET estado = 'RECHAZADO', 
                            sunat_description = COALESCE($2, sunat_description),
                            sunat_responsecode = COALESCE($3, sunat_responsecode),
                            fecha_modificacion = CURRENT_TIMESTAMP
                        WHERE id = $1
                    `, [
                        fila.facturacion_id,
                        consulta.data?.sunat_description || consulta.data?.errors || 'Rechazado por SUNAT',
                        consulta.data?.sunat_responsecode || null
                    ]);
                    rechazados++;
                }
            } catch (err) {
                console.error(`[CRON NUBEFACT] Error reconciliando facturacion ${fila.facturacion_id}:`, err.message);
            }
        }
    } catch (err) {
        try { await client.query('ROLLBACK'); } catch (e) { }
        console.error('[CRON NUBEFACT] Error en lote:', err.message);
    } finally {
        client.release();
    }

    return { procesados, aceptados, rechazados };
};

module.exports = { reconciliarPendientesSunat };