/*
 * Recuperación explícita de una autorización histórica de nota de crédito.
 * Por defecto es SOLO LECTURA. Encolar requiere dos confirmaciones y nunca
 * llama a NubeFact; la emisión queda a cargo del worker después de activarlo.
 */
const db = require('../config/database');
const worker = require('../modules/faregas/services/faregas-notas-credito-worker.service');

const argumento = (nombre) => {
    const prefijo = `--${nombre}=`;
    return process.argv.find((item) => item.startsWith(prefijo))?.slice(prefijo.length) || null;
};

const solicitudId = Number(argumento('solicitud'));
const solicitarEncolado = process.argv.includes('--encolar');

if (!Number.isInteger(solicitudId) || solicitudId <= 0) {
    throw new Error('Use --solicitud=<id>. Sin --encolar el procedimiento es de solo lectura.');
}

const main = async () => {
    const client = await db.connect();
    try {
        const colaExiste = (await client.query(`
            SELECT to_regclass('public.fg_nota_credito_trabajo') IS NOT NULL AS existe
        `)).rows[0]?.existe === true;
        const columnasTrabajo = colaExiste
            ? 't.id AS trabajo_id, t.estado AS trabajo_estado'
            : 'NULL::bigint AS trabajo_id, NULL::varchar AS trabajo_estado';
        const joinTrabajo = colaExiste
            ? 'LEFT JOIN fg_nota_credito_trabajo t ON t.solicitud_id = s.id'
            : '';
        const result = await client.query(`
            SELECT s.*, c.numero_certificado, f.nro_comprobante,
                   f.estado AS facturacion_estado, f.aceptada_sunat,
                   f.entorno_facturador,
                   EXISTS (
                       SELECT 1 FROM fg_facturacion_intento fi
                       WHERE fi.facturacion_id = f.id
                         AND fi.solicitud IS NOT NULL
                   ) AS tiene_snapshot_fiscal,
                   EXISTS (
                       SELECT 1 FROM fg_credito nc
                       WHERE nc.facturacion_id = f.id
                         AND nc.estado <> 'ANULADO'
                   ) AS tiene_nota,
                   ${columnasTrabajo}
            FROM fg_solicitud_operacion s
            JOIN fg_certificado c ON c.id = s.certificado_id
            JOIN fg_facturacion f ON f.id = s.facturacion_id
            ${joinTrabajo}
            WHERE s.id = $1
        `, [solicitudId]);
        if (result.rowCount === 0) throw new Error('SOLICITUD_NO_ENCONTRADA');
        const row = result.rows[0];
        const resumen = {
            solicitudId: Number(row.id),
            certificado: row.numero_certificado,
            comprobante: row.nro_comprobante,
            tipo: row.tipo_operacion,
            estadoSolicitud: row.estado,
            motivoCodigo: row.datos_propuestos?.motivoCodigo || null,
            entorno: row.entorno_facturador,
            estadoComprobante: row.facturacion_estado,
            aceptadaSunat: row.aceptada_sunat,
            tieneSnapshotFiscal: row.tiene_snapshot_fiscal,
            tieneNota: row.tiene_nota,
            colaDisponible: colaExiste,
            trabajoId: row.trabajo_id ? Number(row.trabajo_id) : null,
            trabajoEstado: row.trabajo_estado || null,
        };
        console.log(JSON.stringify(resumen, null, 2));
        if (!solicitarEncolado) {
            console.log('Diagnóstico terminado. No se modificó PostgreSQL ni se llamó a NubeFact.');
            return;
        }

        const confirmacionEsperada = `SOLICITUD_${solicitudId}`;
        if (process.env.FAREGAS_CONFIRMAR_RECUPERACION !== confirmacionEsperada) {
            throw new Error(`CONFIRMACION_REQUERIDA_${confirmacionEsperada}`);
        }
        if (String(row.tipo_operacion) !== 'EMITIR_NOTA_CREDITO' || String(row.estado) !== 'APROBADA') {
            throw new Error('SOLICITUD_NO_RECUPERABLE');
        }
        if (String(row.entorno_facturador).toUpperCase() !== 'DEMO') {
            throw new Error('RECUPERACION_SOLO_DEMO');
        }
        if (row.aceptada_sunat !== true || String(row.facturacion_estado).toUpperCase() !== 'ACEPTADO') {
            throw new Error('COMPROBANTE_ORIGINAL_NO_CONFIRMADO');
        }
        if (!row.tiene_snapshot_fiscal || row.tiene_nota || row.trabajo_id) {
            throw new Error('RECUPERACION_NO_SEGURA_O_YA_INICIADA');
        }

        await client.query('BEGIN');
        await worker.encolarAprobacion(client, row, row.usuario_decision);
        await client.query('COMMIT');
        console.log('Trabajo encolado. Este script NO llamó a NubeFact.');
    } catch (error) {
        try { await client.query('ROLLBACK'); } catch (_rollbackError) { /* sin acción */ }
        throw error;
    } finally {
        client.release();
        await db.end();
    }
};

main().catch((error) => {
    console.error(error.code || error.message);
    process.exitCode = 1;
});
