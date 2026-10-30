const { randomUUID } = require('node:crypto');
const db = require('../../../config/database');
const documentosService = require('./faregas-documentos-electronicos.service');
const integrationsConfig = require('../../../config/integrations.config');
const { esDocumentoBaseOperable } = require('./faregas-documento-tributario-policy');
const {
    normalizarMotivoNotaCredito,
    esMotivoCorreccionDescripcion
} = require('./faregas-notas-credito.constants');

const ESTADOS_TERMINALES = new Set(['ACEPTADA', 'RECHAZADA', 'BLOQUEADA']);
const ESTADOS_RECLAMABLES = new Set([
    'EN_COLA',
    'ESPERANDO_COMPROBANTE',
    'PENDIENTE_SUNAT',
    'RESULTADO_INCIERTO',
    'ERROR'
]);

const errorWorker = (code, message = code, statusCode = 409) => {
    const error = new Error(message);
    error.code = code;
    error.statusCode = statusCode;
    return error;
};

const normalizarEntorno = (valor) => {
    const entorno = String(valor || '').trim().toUpperCase();
    return entorno === 'PRODUCTION' ? 'PRODUCCION' : entorno;
};

const datosAprobados = (solicitud) => {
    const datos = solicitud.datos_propuestos || solicitud.datosPropuestos || {};
    const motivoCodigo = normalizarMotivoNotaCredito(datos.motivoCodigo);
    if (!motivoCodigo || !['01', '02', '03'].includes(motivoCodigo)) {
        throw errorWorker('MOTIVO_NOTA_CREDITO_AUTORIZACION_INVALIDO');
    }
    const descripcionCorregida = String(
        datos.descripcionCorregida || datos.descripcion || ''
    ).trim();
    // Para motivo 03, la descripción es obligatoria para emitir.
    // Si falta, se devuelve null y el worker marcará el trabajo como BLOQUEADA.
    const descripcionFinal = esMotivoCorreccionDescripcion(motivoCodigo)
        ? (descripcionCorregida.length >= 5 ? descripcionCorregida : null)
        : null;
    return {
        motivoCodigo,
        itemIndice: datos.itemIndice === undefined || datos.itemIndice === null
            ? null
            : Number(datos.itemIndice),
        descripcionCorregida: descripcionFinal
    };
};

const mapearEstadoTrabajo = (estadoNota) => {
    const estado = String(estadoNota || '').trim().toUpperCase();
    if (estado === 'ACEPTADO') return 'ACEPTADA';
    if (estado === 'RECHAZADO') return 'RECHAZADA';
    if (['PENDIENTE', 'PENDIENTE_SUNAT', 'EN_PROCESO'].includes(estado)) return 'PENDIENTE_SUNAT';
    return 'RESULTADO_INCIERTO';
};

const crearWorker = ({
    database = db,
    documentos = documentosService,
    config = integrationsConfig,
    logger = console,
    crearPropietario = randomUUID
} = {}) => {
    let procesamientoLocal = null;

    const encolarAprobacion = async (executor, solicitud, username) => {
        const tipo = String(solicitud.tipo_operacion || solicitud.tipoOperacion || '').trim().toUpperCase();
        const estado = String(solicitud.estado || '').trim().toUpperCase();
        if (tipo !== 'EMITIR_NOTA_CREDITO' || estado !== 'APROBADA') return null;
        const datos = datosAprobados(solicitud);
        const solicitudId = Number(solicitud.id);
        const certificadoId = Number(solicitud.certificado_id || solicitud.certificadoId);
        const facturacionId = Number(solicitud.facturacion_id || solicitud.facturacionId);
        const empresaKey = solicitud.empresa_key || solicitud.empresaKey;
        const plantaKey = solicitud.planta_key || solicitud.plantaKey;
        const sustento = String(solicitud.motivo || '').trim();
        if (!solicitudId || !certificadoId || !facturacionId || !empresaKey || !plantaKey || !sustento) {
            throw errorWorker('SOLICITUD_NOTA_INCOMPLETA');
        }

        const insertada = await executor.query(`
            INSERT INTO fg_nota_credito_trabajo (
                solicitud_id, certificado_id, facturacion_id, empresa_key, planta_key,
                motivo_codigo, sustento_aprobado, datos_aprobados, estado, usuario_ejecutor
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,'EN_COLA',$9)
            ON CONFLICT (solicitud_id) DO NOTHING
            RETURNING *
        `, [
            solicitudId,
            certificadoId,
            facturacionId,
            empresaKey,
            plantaKey,
            datos.motivoCodigo,
            sustento,
            JSON.stringify(datos),
            username
        ]);
        const creada = insertada.rowCount > 0;
        const trabajo = creada
            ? insertada.rows[0]
            : (await executor.query(`
                SELECT * FROM fg_nota_credito_trabajo WHERE solicitud_id = $1
            `, [solicitudId])).rows[0];
        if (!trabajo) throw errorWorker('TRABAJO_NOTA_NO_RECUPERABLE');

        if (creada) {
            const resultado = {
                tipoOperacion: 'NOTA_CREDITO',
                trabajoId: Number(trabajo.id),
                estado: 'AUTORIZADA_EN_COLA',
                motivoCodigo: datos.motivoCodigo
            };
            await executor.query(`
                UPDATE fg_solicitud_operacion
                SET resultado_fiscal = $2::jsonb,
                    fecha_modificacion = CURRENT_TIMESTAMP
                WHERE id = $1 AND estado = 'APROBADA'
            `, [solicitudId, JSON.stringify(resultado)]);
            await executor.query(`
                INSERT INTO fg_solicitud_operacion_evento (
                    solicitud_id, tipo_evento, estado_anterior, estado_posterior,
                    usuario_responsable, comentario, metadatos
                ) VALUES (
                    $1, 'NOTA_CREDITO_ENCOLADA', 'APROBADA', 'APROBADA',
                    $2, 'La autorización generó un trabajo fiscal persistente.', $3::jsonb
                )
            `, [solicitudId, username, JSON.stringify(resultado)]);
        }
        return { ...trabajo, creada };
    };

    const reclamarUno = async () => {
        const client = await database.connect();
        const propietario = crearPropietario();
        const leaseMs = Math.max(30000, Number(config.nubefact?.notasWorkerLeaseMs) || 120000);
        try {
            await client.query('BEGIN');
            const encontrado = await client.query(`
                SELECT t.*, s.estado AS solicitud_estado, s.resultado_fiscal,
                       f.entorno_facturador, f.estado AS facturacion_estado,
                       f.aceptada_sunat AS facturacion_aceptada_sunat,
                       f.proveedor AS facturacion_proveedor,
                       f.nro_comprobante AS facturacion_nro_comprobante,
                       f.serie AS facturacion_serie,
                       f.numero AS facturacion_numero,
                       f.enlace_pdf AS facturacion_enlace_pdf,
                       f.enlace_xml AS facturacion_enlace_xml,
                       u.perfil_id AS usuario_perfil_id
                FROM fg_nota_credito_trabajo t
                JOIN fg_solicitud_operacion s ON s.id = t.solicitud_id
                JOIN fg_facturacion f ON f.id = t.facturacion_id
                JOIN fg_usuario u ON u.username = t.usuario_ejecutor
                WHERE (
                    (t.estado = ANY($1::varchar[]) AND t.disponible_desde <= CURRENT_TIMESTAMP)
                    OR (t.estado = 'EMITIENDO' AND t.bloqueo_hasta < CURRENT_TIMESTAMP)
                )
                  AND (t.estado <> 'ERROR' OR t.intentos < $2)
                ORDER BY t.disponible_desde, t.id
                LIMIT 1
                FOR UPDATE OF t SKIP LOCKED
            `, [Array.from(ESTADOS_RECLAMABLES), Number(config.nubefact?.maxAttempts) || 5]);
            if (encontrado.rowCount === 0) {
                await client.query('COMMIT');
                return null;
            }
            const anterior = encontrado.rows[0];
            const actualizado = await client.query(`
                UPDATE fg_nota_credito_trabajo
                SET estado = 'EMITIENDO',
                    propietario_bloqueo = $2::uuid,
                    bloqueo_hasta = CURRENT_TIMESTAMP + ($3::bigint * INTERVAL '1 millisecond'),
                    intentos = intentos + 1,
                    fecha_inicio = COALESCE(fecha_inicio, CURRENT_TIMESTAMP),
                    fecha_modificacion = CURRENT_TIMESTAMP
                WHERE id = $1
                RETURNING *
            `, [anterior.id, propietario, leaseMs]);
            await client.query(`
                UPDATE fg_solicitud_operacion
                SET resultado_fiscal = jsonb_build_object(
                        'tipoOperacion', 'NOTA_CREDITO',
                        'trabajoId', $2::bigint,
                        'estado', 'EMITIENDO'
                    ),
                    fecha_modificacion = CURRENT_TIMESTAMP
                WHERE id = $1 AND estado IN ('APROBADA', 'EN_EJECUCION', 'ERROR')
            `, [anterior.solicitud_id, anterior.id]);
            await client.query('COMMIT');
            return {
                ...anterior,
                ...actualizado.rows[0],
                estado_anterior: anterior.estado,
                propietario_bloqueo: propietario
            };
        } catch (error) {
            try { await client.query('ROLLBACK'); } catch (_rollbackError) { /* sin acción */ }
            throw error;
        } finally {
            client.release();
        }
    };

    const buscarNota = async (trabajo) => {
        const notaIdResultado = Number(trabajo.resultado_fiscal?.notaId || 0);
        const creditoId = Number(trabajo.credito_id || notaIdResultado || 0);
        const result = await database.query(`
            SELECT *
            FROM fg_credito
            WHERE facturacion_id = $1
              AND (
                  ($2::bigint > 0 AND id = $2)
                  OR ($2::bigint = 0 AND motivo_codigo = $3 AND sustento = $4)
              )
            ORDER BY id DESC
            LIMIT 1
        `, [trabajo.facturacion_id, creditoId, trabajo.motivo_codigo, trabajo.sustento_aprobado]);
        return result.rows[0] || null;
    };

    const finalizarTrabajo = async (trabajo, estado, nota = null, error = null) => {
        const terminal = ESTADOS_TERMINALES.has(estado);
        const proximaConsulta = ['ESPERANDO_COMPROBANTE', 'PENDIENTE_SUNAT', 'RESULTADO_INCIERTO', 'ERROR'].includes(estado)
            ? new Date(Date.now() + (Number(config.nubefact?.reconciliationRetryMs) || 900000))
            : new Date();
        const resultado = nota ? {
            notaId: Number(nota.id),
            nroComprobante: nota.nroComprobante || nota.nro_comprobante || null,
            estado: nota.estado,
            aceptadaSunat: nota.aceptadaSunat ?? nota.aceptada_sunat ?? null,
            sunatDescription: nota.sunatDescription || nota.sunat_description || null
        } : null;
        await database.query(`
            UPDATE fg_nota_credito_trabajo
            SET estado = $2,
                credito_id = COALESCE($3, credito_id),
                resultado = COALESCE($4::jsonb, resultado),
                ultimo_error_codigo = $5,
                ultimo_error_mensaje = $6,
                disponible_desde = $7,
                propietario_bloqueo = NULL,
                bloqueo_hasta = NULL,
                fecha_finalizacion = CASE WHEN $8 THEN CURRENT_TIMESTAMP ELSE fecha_finalizacion END,
                fecha_modificacion = CURRENT_TIMESTAMP
            WHERE id = $1 AND propietario_bloqueo = $9::uuid
        `, [
            trabajo.id,
            estado,
            nota?.id || null,
            resultado ? JSON.stringify(resultado) : null,
            error?.code || null,
            error?.message || null,
            proximaConsulta,
            terminal,
            trabajo.propietario_bloqueo
        ]);
        const estadosSolicitud = {
            ESPERANDO_COMPROBANTE: 'APROBADA',
            PENDIENTE_SUNAT: 'EN_EJECUCION',
            RESULTADO_INCIERTO: 'EN_EJECUCION',
            ACEPTADA: 'COMPLETADA',
            RECHAZADA: 'ERROR',
            BLOQUEADA: 'ERROR',
            ERROR: 'ERROR'
        };
        const estadoSolicitud = estadosSolicitud[estado];
        if (estadoSolicitud) {
            const resultadoSolicitud = {
                tipoOperacion: 'NOTA_CREDITO',
                trabajoId: Number(trabajo.id),
                estado,
                notaId: nota?.id ? Number(nota.id) : null,
                nroComprobante: nota?.nroComprobante || nota?.nro_comprobante || null,
                aceptadaSunat: nota?.aceptadaSunat ?? nota?.aceptada_sunat ?? null,
                errorCodigo: error?.code || null,
                errorMensaje: error?.message || null,
                causa: estado === 'ESPERANDO_COMPROBANTE'
                    ? 'El comprobante original aún no tiene confirmación fiscal.'
                    : null
            };
            await database.query(`
                UPDATE fg_solicitud_operacion
                SET estado = $2,
                    resultado_fiscal = $3::jsonb,
                    fecha_modificacion = CURRENT_TIMESTAMP
                WHERE id = $1
                  AND estado IN ('APROBADA', 'EN_EJECUCION', 'COMPLETADA', 'ERROR')
            `, [trabajo.solicitud_id, estadoSolicitud, JSON.stringify(resultadoSolicitud)]);
        }
    };

        const procesarReclamado = async (trabajo, dependencies = {}) => {
            const entorno = normalizarEntorno(trabajo.entorno_facturador || config.nubefact?.environment);
        if (!['DEMO', 'PRODUCCION'].includes(entorno)
            || (entorno === 'PRODUCCION' && config.nubefact?.productionConfirmed !== true)) {
            const error = errorWorker('ENTORNO_NUBEFACT_NO_AUTORIZADO');
            await finalizarTrabajo(trabajo, 'BLOQUEADA', null, error);
            return { trabajoId: Number(trabajo.id), estado: 'BLOQUEADA', error: error.code };
        }
        const usuario = {
            username: trabajo.usuario_ejecutor,
            planta_key: trabajo.planta_key,
            empresa_key: trabajo.empresa_key,
            perfil_id: trabajo.usuario_perfil_id
        };
        try {
            let notaExistente = await buscarNota(trabajo);
            let nota;
            if (notaExistente) {
                const estadoExistente = String(notaExistente.estado || '').toUpperCase();
                if (estadoExistente === 'ACEPTADO' || estadoExistente === 'RECHAZADO') {
                    nota = notaExistente;
                } else {
                    nota = await documentos.consultarNota(
                        Number(trabajo.certificado_id),
                        'CREDITO',
                        Number(notaExistente.id),
                        usuario,
                        dependencies
                    );
                }
            } else {
                const comprobanteConfirmado = esDocumentoBaseOperable({
                    entorno_facturador: trabajo.entorno_facturador,
                    estado: trabajo.facturacion_estado,
                    aceptada_sunat: trabajo.facturacion_aceptada_sunat,
                    proveedor: trabajo.facturacion_proveedor,
                    nro_comprobante: trabajo.facturacion_nro_comprobante,
                    serie: trabajo.facturacion_serie,
                    numero: trabajo.facturacion_numero,
                    enlace_pdf: trabajo.facturacion_enlace_pdf,
                    enlace_xml: trabajo.facturacion_enlace_xml
                });
                                if (!comprobanteConfirmado) {
                    await finalizarTrabajo(trabajo, 'ESPERANDO_COMPROBANTE');
                    return {
                        trabajoId: Number(trabajo.id),
                        estado: 'ESPERANDO_COMPROBANTE'
                    };
                }
                const aprobados = trabajo.datos_aprobados || {};
                // Para motivo 03, la descripción corregida es obligatoria.
                // Si falta, marcar como bloqueada sin intentar emitir.
                if (trabajo.motivo_codigo === '03' && (!aprobados.descripcionCorregida || aprobados.descripcionCorregida.length < 5)) {
                    const error = errorWorker('DESCRIPCION_CORREGIDA_REQUERIDA');
                    await finalizarTrabajo(trabajo, 'BLOQUEADA', null, error);
                    return { trabajoId: Number(trabajo.id), estado: 'BLOQUEADA', error: error.code };
                }

                // Exclusión mutua: verificar si existe una operación fiscal incompatible
                // (baja fiscal en trámite o aceptada) para el mismo comprobante.
                const bajaEnTramite = await database.query(`
                    SELECT id FROM fg_documento_anulacion
                    WHERE facturacion_id = $1
                      AND estado IN ('BORRADOR', 'PENDIENTE', 'ACEPTADO')
                    LIMIT 1
                `, [trabajo.facturacion_id]);
                if (bajaEnTramite.rowCount > 0) {
                    const error = errorWorker('OPERACION_FISCAL_INCOMPATIBLE');
                    await finalizarTrabajo(trabajo, 'BLOQUEADA', null, error);
                    return { trabajoId: Number(trabajo.id), estado: 'BLOQUEADA', error: error.code };
                }

                // Exclusión mutua: verificar si ya existe una nota de crédito para el mismo comprobante
                const notaExistente = await database.query(`
                    SELECT id FROM fg_credito
                    WHERE facturacion_id = $1
                      AND estado IN ('PENDIENTE', 'PENDIENTE_SUNAT', 'ACEPTADA', 'ERROR')
                    LIMIT 1
                `, [trabajo.facturacion_id]);
                if (notaExistente.rowCount > 0) {
                    const error = errorWorker('NOTA_CREDITO_YA_EXISTE');
                    await finalizarTrabajo(trabajo, 'BLOQUEADA', null, error);
                    return { trabajoId: Number(trabajo.id), estado: 'BLOQUEADA', error: error.code };
                }

                nota = await documentos.emitirNota(
                    Number(trabajo.certificado_id),
                    'CREDITO',
                    {
                        motivoCodigo: trabajo.motivo_codigo,
                        sustento: trabajo.sustento_aprobado,
                        solicitudId: Number(trabajo.solicitud_id),
                        itemIndice: aprobados.itemIndice,
                        descripcionCorregida: aprobados.descripcionCorregida
                    },
                    usuario,
                    dependencies
                );
            }
            const estadoTrabajo = mapearEstadoTrabajo(nota.estado);
                        await finalizarTrabajo(trabajo, estadoTrabajo, nota);
                        return { trabajoId: Number(trabajo.id), estado: estadoTrabajo, nota };
        } catch (error) {
            const notaPosterior = await buscarNota(trabajo).catch(() => null);
            if (notaPosterior) {
                const estadoTrabajo = mapearEstadoTrabajo(notaPosterior.estado);
                const seguro = estadoTrabajo === 'ACEPTADA' || estadoTrabajo === 'RECHAZADA'
                    ? estadoTrabajo
                    : 'RESULTADO_INCIERTO';
                await finalizarTrabajo(trabajo, seguro, notaPosterior, error);
                return { trabajoId: Number(trabajo.id), estado: seguro, nota: notaPosterior, error: error.code };
            }
            const bloqueos = new Set([
                'SNAPSHOT_FISCAL_NO_DISPONIBLE',
                'SNAPSHOT_FISCAL_INCOMPLETO',
                'SNAPSHOT_FISCAL_NO_CORRESPONDE',
                'COMPROBANTE_NO_ACEPTADO',
                'SOLICITUD_MOTIVO_NOTA_NO_CORRESPONDE',
                'SOLICITUD_NOTA_INCOMPLETA',
                'PERMISO_DENEGADO_NOTA_CREDITO',
                'SOLICITUD_SEDE_NO_AUTORIZADA',
                'DESCRIPCION_CORREGIDA_REQUERIDA',
                'OPERACION_FISCAL_INCOMPATIBLE'
            ]);
            const estadoTrabajo = bloqueos.has(error.code) ? 'BLOQUEADA' : 'ERROR';
            await finalizarTrabajo(trabajo, estadoTrabajo, null, error);
            return { trabajoId: Number(trabajo.id), estado: estadoTrabajo, error: error.code || error.message };
        }
    };

    const procesarPendientes = async (opciones = {}) => {
        if (opciones.forzar !== true && config.nubefact?.notasAutoEmissionEnabled !== true) {
            return { habilitado: false, reclamados: 0, resultados: [] };
        }
        const batchSize = Math.min(50, Math.max(
            1,
            Number(opciones.batchSize || config.nubefact?.notasWorkerBatchSize) || 10
        ));
        const resultados = [];
        for (let index = 0; index < batchSize; index++) {
            const trabajo = await reclamarUno();
            if (!trabajo) break;
            resultados.push(await procesarReclamado(trabajo, opciones.dependencies || {}));
        }
        return { habilitado: true, reclamados: resultados.length, resultados };
    };

    const despertar = () => {
        if (config.nubefact?.notasAutoEmissionEnabled !== true || procesamientoLocal) return procesamientoLocal;
        procesamientoLocal = new Promise((resolve) => {
            setImmediate(async () => {
                try {
                    resolve(await procesarPendientes());
        } catch (error) {
                                logger.error('[FAREGAS NOTAS WORKER] Error procesando cola:', error.message);
                    resolve({ habilitado: true, reclamados: 0, resultados: [], error: error.code || error.message });
                } finally {
                    procesamientoLocal = null;
                }
            });
        });
        return procesamientoLocal;
    };

    return {
        encolarAprobacion,
        procesarPendientes,
        despertar,
        _private: { reclamarUno, procesarReclamado, buscarNota, finalizarTrabajo }
    };
};

const worker = crearWorker();

module.exports = {
    ...worker,
    _private: {
        crearWorker,
        datosAprobados,
        mapearEstadoTrabajo,
        normalizarEntorno,
        ESTADOS_RECLAMABLES,
        ESTADOS_TERMINALES,
        errorWorker
    }
};
