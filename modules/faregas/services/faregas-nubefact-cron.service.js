const db = require('../../../config/database');
const nubefactService = require('../../../services/integrations/nubefact.service');
const nubefactConfigService = require('./faregas-nubefact-config.service');

const reconciliarPendientesSunat = async (opciones = {}) => {
    const batchSize = opciones.batchSize || 50;
    const client = await db.connect();
    let procesados = 0;
    let aceptados = 0;
    let rechazados = 0;

    try {
        await client.query('BEGIN');
        // For Update Skip Locked para evitar que otras instancias manipulen las mismas filas
        const query = `
            SELECT f.id as facturacion_id, f.certificado_id, f.estado, f.serie, f.numero, f.tipo_comprobante,
                   c.planta_key, e.ruc as empresa_ruc
            FROM fg_facturacion f
            JOIN fg_certificado c ON f.certificado_id = c.id
            JOIN fg_planta p ON c.planta_key = p.planta_key
            JOIN fg_empresa e ON p.empresa_key = e.id
            WHERE f.estado = 'PENDIENTE_SUNAT'
            ORDER BY f.fecha_modificacion ASC
            LIMIT $1
            FOR UPDATE SKIP LOCKED
        `;
        
        const pendientes = await client.query(query, [batchSize]);

        for (const fila of pendientes.rows) {
            procesados++;
            try {
                // Obtener configuracion (Ruta y Token de la empresa/planta)
                const conf = await nubefactConfigService.resolverParaPlanta(fila.planta_key);
                
                // Consultar nubefact
                const consulta = await nubefactService.consultarComprobante({
                    tipoDeComprobante: fila.tipo_comprobante === 'FACTURA' ? 1 : 2,
                    serie: fila.serie,
                    numero: fila.numero
                }, { credentials: conf.credentials });
                
                if (consulta.status === 'ACCEPTED') {
                    await client.query(`
                        UPDATE fg_facturacion 
                        SET estado = 'ACEPTADO',
                            aceptada_sunat = TRUE,
                            sunat_ticket_numero = COALESCE($1, sunat_ticket_numero),
                            enlace_pdf = COALESCE($2, enlace_pdf),
                            enlace_xml = COALESCE($3, enlace_xml),
                            enlace_cdr = COALESCE($4, enlace_cdr),
                            fecha_modificacion = CURRENT_TIMESTAMP
                        WHERE id = $5
                    `, [
                        consulta.data?.sunat_ticket_numero || null,
                        consulta.data?.enlace_del_pdf || null,
                        consulta.data?.enlace_del_xml || null,
                        consulta.data?.enlace_del_cdr || null,
                        fila.facturacion_id
                    ]);
                    aceptados++;
                } else if (consulta.status === 'REJECTED') {
                    await client.query(`
                        UPDATE fg_facturacion 
                        SET estado = 'RECHAZADO', 
                            sunat_description = COALESCE($1, sunat_description),
                            fecha_modificacion = CURRENT_TIMESTAMP
                        WHERE id = $2
                    `, [
                        consulta.data?.sunat_description || consulta.data?.errors || 'Rechazado por SUNAT',
                        fila.facturacion_id
                    ]);
                    rechazados++;
                }
            } catch (err) {
                console.error(`[CRON NUBEFACT] Error reconciliando facturacion ${fila.facturacion_id}:`, err.message);
            }
        }

        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('[CRON NUBEFACT] Error en lote:', err.message);
    } finally {
        client.release();
    }

    return { procesados, aceptados, rechazados };
};

module.exports = {
    reconciliarPendientesSunat
};
