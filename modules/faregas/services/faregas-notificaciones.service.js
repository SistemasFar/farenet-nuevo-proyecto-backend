let _db = null;
const getDb = () => {
    if (!_db) _db = require('../../../config/database');
    return _db;
};
const {
    PERMISOS_SOLICITUD
} = require('./faregas-solicitudes-operacion.constants');

const errorNegocio = (code, statusCode = 400, detalles) => {
    const error = new Error(code);
    error.code = code;
    error.statusCode = statusCode;
    if (detalles !== undefined) error.detalles = detalles;
    return error;
};

/**
 * Determina los usuarios destinatarios de una notificación para una planta dada.
 * Criterios:
 *  - Usuario activo (fg_usuario.estado = TRUE)
 *  - Tiene acceso a la planta (fg_usuario_planta + fg_planta activo)
 *  - Tiene permiso efectivo para APROBAR, RECHAZAR o ADMINISTRAR solicitudes
 * No se usan nombres de perfil (SISTEMAS, ADMINISTRADOR, etc.) para decidir.
 */
const obtenerDestinatariosPorPlanta = async (executor, plantaKey, empresaKey = null) => {
    const permisosClave = Object.values(PERMISOS_SOLICITUD).filter((p) =>
        p === PERMISOS_SOLICITUD.APROBAR ||
        p === PERMISOS_SOLICITUD.RECHAZAR ||
        p === PERMISOS_SOLICITUD.ADMINISTRAR
    );

    const result = await executor.query(`
        SELECT DISTINCT u.username
        FROM fg_usuario u
        JOIN fg_usuario_planta up ON up.usuario_username = u.username
        JOIN fg_planta p ON p.key = up.plantas_key AND p.activo = TRUE
        JOIN fg_perfil_permiso pp ON pp.perfil_clave = u.perfil_id
        JOIN fg_permiso perm ON perm.clave = pp.permiso_clave AND perm.activo = TRUE
        WHERE u.estado = TRUE
          AND up.plantas_key = $1
          AND pp.permiso_clave = ANY($2::varchar[])
          AND ($3::varchar IS NULL OR p.empresa_key = $3)
    `, [plantaKey, permisosClave, empresaKey]);

    return result.rows.map((row) => row.username);
};

/**
 * Crea una notificación y sus destinatarios. Evita duplicados por evento_clave + usuario_id.
 * Usa SAVEPOINT para que un error de notificación no aborte la transacción principal.
 * Debe llamarse DENTRO de la transacción de la solicitud (antes del COMMIT).
 */
const crear = async (executor, data, destinatarios) => {
    if (!data || !data.eventoClave || !data.tipo || !data.titulo || !data.mensaje) {
        throw errorNegocio('NOTIFICACION_DATOS_INCOMPLETOS', 400);
    }

    await executor.query('SAVEPOINT sp_notificacion_crear');

    try {
        let result = await executor.query(`
            INSERT INTO fg_notificacion (
                evento_clave, tipo, titulo, mensaje, planta_key, empresa_key,
                entidad_tipo, entidad_id, destino_navegacion, creado_por
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            ON CONFLICT (evento_clave) DO NOTHING
            RETURNING id
        `, [
            data.eventoClave,
            data.tipo,
            data.titulo,
            data.mensaje,
            data.plantaKey || null,
            data.empresaKey || null,
            data.entidadTipo || null,
            data.entidadId || null,
            data.destinoNavegacion || null,
            data.creadoPor || null
        ]);

        let notificacionId;
        if (result.rows.length > 0) {
            notificacionId = Number(result.rows[0].id);
        } else {
            const existing = await executor.query(
                'SELECT id FROM fg_notificacion WHERE evento_clave = $1',
                [data.eventoClave]
            );
            if (existing.rows.length === 0) {
                throw errorNegocio('NOTIFICACION_NO_ENCONTRADA', 500);
            }
            notificacionId = Number(existing.rows[0].id);
        }

        for (const usuarioId of destinatarios) {
            await executor.query(`
                INSERT INTO fg_notificacion_destinatario (notificacion_id, usuario_id)
                VALUES ($1, $2)
                ON CONFLICT (notificacion_id, usuario_id) DO NOTHING
            `, [notificacionId, usuarioId]);
        }

        return notificacionId;
    } catch (error) {
        try { await executor.query('ROLLBACK TO SAVEPOINT sp_notificacion_crear'); } catch (_) {}
        return null;
    }
};

/**
 * Crea una notificación vinculada a una solicitud administrativa, notificando a
 * los usuarios autorizados para aprobar/rechazar en la planta de la solicitud.
 * Evita duplicados para el mismo evento de solicitud y destinatario.
 */
const crearParaSolicitud = async (executor, solicitud, dataBase) => {
    const destinatarios = await obtenerDestinatariosPorPlanta(
        executor,
        solicitud.planta_key,
        solicitud.empresa_key
    );

    if (destinatarios.length === 0) return 0;

    const eventoClave = `SOLICITUD_${solicitud.id}_${dataBase.eventoClave || 'CREADA'}`;
    const destinoNavegacion = `/faregas/solicitudes-operacion/${solicitud.id}`;

    const notificacionId = await crear(executor, {
        eventoClave,
        tipo: dataBase.tipo || 'SOLICITUD_PENDIENTE_APROBACION',
        titulo: dataBase.titulo || 'Nueva solicitud pendiente de aprobación',
        mensaje: dataBase.mensaje || `Se ha creado una solicitud ${solicitud.tipo_operacion} pendiente de su aprobación.`,
        plantaKey: solicitud.planta_key,
        empresaKey: solicitud.empresa_key,
        entidadTipo: 'SOLICITUD_OPERACION',
        entidadId: solicitud.id,
        destinoNavegacion,
        creadoPor: solicitud.usuario_solicitante
    }, destinatarios);

    return notificacionId ?? 0;
};

/**
 * Crea una notificación para el usuario solicitante de una solicitud,
 * vinculada a la solicitud y su estado (aprobada/rechazada).
 * Incluye destino de navegación hacia la solicitud.
 */
const crearParaSolicitante = async (executor, solicitud, tipoEvento, titulo, mensaje, creadoPor) => {
    const eventoClave = `SOLICITUD_${solicitud.id}_${tipoEvento}`;
    const destinoNavegacion = `/faregas/solicitudes-operacion/${solicitud.id}`;

    const notificacionId = await crear(executor, {
        eventoClave,
        tipo: tipoEvento,
        titulo,
        mensaje,
        plantaKey: solicitud.planta_key || null,
        empresaKey: solicitud.empresa_key || null,
        entidadTipo: 'SOLICITUD_OPERACION',
        entidadId: solicitud.id,
        destinoNavegacion,
        creadoPor: creadoPor || null
    }, [solicitud.usuario_solicitante]);

    return notificacionId ?? 0;
};

/**
 * Lista las notificaciones de un usuario autenticado.
 * El usuario se obtiene del contexto autenticado, nunca de un ID enviado por el frontend.
 */
const listar = async (usuarioId, executor) => {
    if (!usuarioId) throw errorNegocio('USUARIO_REQUERIDO', 401);
    if (!executor) throw errorNegocio('EXECUTOR_REQUERIDO', 500);
    const db = executor;

    const result = await db.query(`
        SELECT n.id, n.evento_clave, n.tipo, n.titulo, n.mensaje, n.planta_key,
               n.empresa_key, n.entidad_tipo, n.entidad_id, n.destino_navegacion,
               n.fecha_creacion, d.leida, d.fecha_lectura
        FROM fg_notificacion n
        JOIN fg_notificacion_destinatario d ON d.notificacion_id = n.id
        WHERE d.usuario_id = $1
        ORDER BY n.fecha_creacion DESC
        LIMIT 50
    `, [usuarioId]);

    return result.rows;
};

/**
 * Cuenta las notificaciones sin leer de un usuario autenticado.
 */
const contarNoLeidas = async (usuarioId, executor) => {
    if (!usuarioId) throw errorNegocio('USUARIO_REQUERIDO', 401);
    if (!executor) throw errorNegocio('EXECUTOR_REQUERIDO', 500);
    const db = executor;

    const result = await db.query(`
        SELECT COUNT(*)::int AS c
        FROM fg_notificacion_destinatario
        WHERE usuario_id = $1 AND leida = FALSE
    `, [usuarioId]);

    return Number(result.rows[0].c);
};

/**
 * Marca una notificación como leída para un usuario autenticado.
 * Impide modificar notificaciones de otros usuarios.
 */
const marcarLeida = async (usuarioId, notificacionId, executor) => {
    if (!usuarioId) throw errorNegocio('USUARIO_REQUERIDO', 401);
    if (!notificacionId) throw errorNegocio('NOTIFICACION_REQUERIDA', 400);
    if (!executor) throw errorNegocio('EXECUTOR_REQUERIDO', 500);
    const db = executor;

    const result = await db.query(`
        UPDATE fg_notificacion_destinatario
        SET leida = TRUE, fecha_lectura = CURRENT_TIMESTAMP
        WHERE usuario_id = $1 AND notificacion_id = $2 AND leida = FALSE
        RETURNING id
    `, [usuarioId, Number(notificacionId)]);

    return result.rowCount > 0;
};

/**
 * Marca todas las notificaciones como leídas para un usuario autenticado.
 */
const marcarTodasLeidas = async (usuarioId, executor) => {
    if (!usuarioId) throw errorNegocio('USUARIO_REQUERIDO', 401);
    if (!executor) throw errorNegocio('EXECUTOR_REQUERIDO', 500);
    const db = executor;

    await db.query(`
        UPDATE fg_notificacion_destinatario
        SET leida = TRUE, fecha_lectura = CURRENT_TIMESTAMP
        WHERE usuario_id = $1 AND leida = FALSE
    `, [usuarioId]);

    return true;
};

module.exports = {
    crear,
    crearParaSolicitud,
    crearParaSolicitante,
    obtenerDestinatariosPorPlanta,
    listar,
    contarNoLeidas,
    marcarLeida,
    marcarTodasLeidas,
    _private: { errorNegocio }
};
