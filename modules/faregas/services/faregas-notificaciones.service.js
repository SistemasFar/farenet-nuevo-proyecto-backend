let _db = null;
const getDb = () => {
    if (!_db) _db = require('../../../config/database');
    return _db;
};
const {
    PERMISOS_SOLICITUD
} = require('./faregas-solicitudes-operacion.constants');
const {
    PERMISO_ACCESO_GLOBAL_SEDES
} = require('./faregas-acceso-sedes.service');

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
 *  - Tiene acceso a la planta por asignación individual o permiso global explícito
 *  - Tiene permiso efectivo para APROBAR o ADMINISTRAR solicitudes
 * No se usan nombres de perfil (SISTEMAS, ADMINISTRADOR, etc.) para decidir.
 */
const obtenerDestinatariosPorPlanta = async (executor, plantaKey, empresaKey = null) => {
    const permisosClave = Object.values(PERMISOS_SOLICITUD).filter((p) =>
        p === PERMISOS_SOLICITUD.APROBAR ||
        p === PERMISOS_SOLICITUD.ADMINISTRAR
    );

    const result = await executor.query(`
        SELECT DISTINCT u.username
        FROM fg_usuario u
        JOIN fg_planta p ON p.key = $1 AND p.activo = TRUE
        JOIN fg_perfil_permiso pp ON pp.perfil_clave = u.perfil_id
        JOIN fg_permiso perm ON perm.clave = pp.permiso_clave AND perm.activo = TRUE
        WHERE u.estado = TRUE
          AND pp.permiso_clave = ANY($2::varchar[])
          AND ($3::varchar IS NULL OR p.empresa_key = $3)
          AND (
              EXISTS (
                  SELECT 1
                  FROM fg_perfil_permiso global_pp
                  JOIN fg_permiso global_perm
                    ON global_perm.clave = global_pp.permiso_clave
                   AND global_perm.activo = TRUE
                  WHERE global_pp.perfil_clave = u.perfil_id
                    AND global_pp.permiso_clave = $4
              )
              OR EXISTS (
                  SELECT 1
                  FROM fg_usuario_planta up
                  JOIN fg_perfil_planta perfil_planta
                    ON perfil_planta.planta_key = up.plantas_key
                   AND perfil_planta.perfil_clave = u.perfil_id
                  WHERE up.usuario_username = u.username
                    AND up.plantas_key = $1
              )
          )
    `, [plantaKey, permisosClave, empresaKey, PERMISO_ACCESO_GLOBAL_SEDES]);

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
 * Crea una notificación para usuarios con permiso de aprobación de notas de crédito
 * (FAREGAS_NOTA_CREDITO_APROBAR) que tengan acceso a la planta de la solicitud.
 * Se usa cuando se crea una solicitud EMITIR_NOTA_CREDITO pendiente de aprobación.
 */
const crearParaAutorizacionNotaCredito = async (executor, solicitud, dataBase) => {
    const permisosClave = [PERMISOS_SOLICITUD.NOTA_CREDITO_APROBAR, PERMISOS_SOLICITUD.ADMINISTRAR];

    const result = await executor.query(`
        SELECT DISTINCT u.username
        FROM fg_usuario u
        JOIN fg_planta p ON p.key = $1 AND p.activo = TRUE
        JOIN fg_perfil_permiso pp ON pp.perfil_clave = u.perfil_id
        JOIN fg_permiso perm ON perm.clave = pp.permiso_clave AND perm.activo = TRUE
        WHERE u.estado = TRUE
          AND pp.permiso_clave = ANY($2::varchar[])
          AND ($3::varchar IS NULL OR p.empresa_key = $3)
          AND (
              EXISTS (
                  SELECT 1
                  FROM fg_perfil_permiso global_pp
                  JOIN fg_permiso global_perm
                    ON global_perm.clave = global_pp.permiso_clave
                   AND global_perm.activo = TRUE
                  WHERE global_pp.perfil_clave = u.perfil_id
                    AND global_pp.permiso_clave = $4
              )
              OR EXISTS (
                  SELECT 1
                  FROM fg_usuario_planta up
                  JOIN fg_perfil_planta perfil_planta
                    ON perfil_planta.planta_key = up.plantas_key
                   AND perfil_planta.perfil_clave = u.perfil_id
                  WHERE up.usuario_username = u.username
                    AND up.plantas_key = $1
              )
          )
    `, [solicitud.planta_key, permisosClave, solicitud.empresa_key, PERMISO_ACCESO_GLOBAL_SEDES]);

    const destinatarios = result.rows.map((row) => row.username);
    if (destinatarios.length === 0) return 0;

    const eventoClave = `SOLICITUD_${solicitud.id}_${dataBase.eventoClave || 'CREADA'}`;
    const destinoNavegacion = `/faregas/solicitudes-operacion/${solicitud.id}`;

    return crear(executor, {
        eventoClave,
        tipo: dataBase.tipo || 'SOLICITUD_PENDIENTE_APROBACION',
        titulo: dataBase.titulo || 'Nueva solicitud de autorización de nota de crédito',
        mensaje: dataBase.mensaje || `Se ha creado una solicitud de autorización de nota de crédito pendiente de su aprobación.`,
        plantaKey: solicitud.planta_key,
        empresaKey: solicitud.empresa_key,
        entidadTipo: 'SOLICITUD_OPERACION',
        entidadId: solicitud.id,
        destinoNavegacion,
        creadoPor: solicitud.usuario_solicitante
    }, destinatarios);
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
 * Lista el historial completo de notificaciones del usuario autenticado.
 * Incluye notificaciones leídas, atendidas, resueltas y pendientes.
 * Soporta búsqueda por texto y filtro por fechas (zona horaria America/Lima).
 * Paginado para evitar descargar todo el historial.
 */
const listarHistorial = async (usuarioId, executor, opciones = {}) => {
    if (!usuarioId) throw errorNegocio('USUARIO_REQUERIDO', 401);
    if (!executor) throw errorNegocio('EXECUTOR_REQUERIDO', 500);
    const db = executor;

    const busqueda = String(opciones.busqueda || '').trim();
    const fechaDesde = opciones.fechaDesde || null;
    const fechaHasta = opciones.fechaHasta || null;
    const pagina = Math.max(1, parseInt(opciones.pagina, 10) || 1);
    // El historial se pagina siempre con un máximo de 10 registros. El límite
    // también se impone en backend para que no pueda omitirse desde el cliente.
    const limite = Math.min(10, Math.max(1, parseInt(opciones.limite, 10) || 10));
    const offset = (pagina - 1) * limite;

    const conditions = ['d.usuario_id = $1'];
    const params = [usuarioId];
    let paramIndex = 2;

    const joinsEnriquecidos = `
        LEFT JOIN fg_solicitud_operacion s
            ON s.id = n.entidad_id
           AND n.entidad_tipo = 'SOLICITUD_OPERACION'
        LEFT JOIN fg_certificado c ON c.id = s.certificado_id
        LEFT JOIN fg_facturacion f ON f.id = s.facturacion_id
        LEFT JOIN fg_planta pl ON pl.key = s.planta_key
        LEFT JOIN fg_usuario us ON us.username = s.usuario_solicitante
        LEFT JOIN persona ps ON ps.nrodocumentoidentidad = us.persona_nrodocumentoidentidad
        LEFT JOIN fg_usuario ud ON ud.username = s.usuario_decision
        LEFT JOIN persona pd ON pd.nrodocumentoidentidad = ud.persona_nrodocumentoidentidad
    `;

    if (busqueda) {
        conditions.push(`(
            n.titulo ILIKE $${paramIndex}
            OR n.mensaje ILIKE $${paramIndex}
            OR n.tipo ILIKE $${paramIndex}
            OR n.evento_clave ILIKE $${paramIndex}
            OR CAST(n.entidad_id AS TEXT) ILIKE $${paramIndex}
            OR n.destino_navegacion ILIKE $${paramIndex}
            OR n.planta_key ILIKE $${paramIndex}
            OR pl.nombre ILIKE $${paramIndex}
            OR s.usuario_solicitante ILIKE $${paramIndex}
            OR s.usuario_decision ILIKE $${paramIndex}
            OR COALESCE(NULLIF(BTRIM(CONCAT_WS(' ', ps.nombres, ps.apellidos)), ''), NULLIF(BTRIM(ps.nombrerazonsocial), '')) ILIKE $${paramIndex}
            OR COALESCE(NULLIF(BTRIM(CONCAT_WS(' ', pd.nombres, pd.apellidos)), ''), NULLIF(BTRIM(pd.nombrerazonsocial), '')) ILIKE $${paramIndex}
            OR c.numero_certificado ILIKE $${paramIndex}
            OR f.nro_comprobante ILIKE $${paramIndex}
            OR s.tipo_operacion ILIKE $${paramIndex}
            OR COALESCE(s.datos_propuestos ->> 'motivoCodigo', '') ILIKE $${paramIndex}
        )`);
        params.push(`%${busqueda}%`);
        paramIndex++;
    }

    if (fechaDesde) {
        conditions.push(`n.fecha_creacion >= ($${paramIndex}::date::timestamp AT TIME ZONE 'America/Lima')`);
        params.push(fechaDesde);
        paramIndex++;
    }

    if (fechaHasta) {
        conditions.push(`n.fecha_creacion < (($${paramIndex}::date + 1)::timestamp AT TIME ZONE 'America/Lima')`);
        params.push(fechaHasta);
        paramIndex++;
    }

    const whereClause = conditions.join(' AND ');

    const countResult = await db.query(`
        SELECT COUNT(*)::int AS total
        FROM fg_notificacion n
        JOIN fg_notificacion_destinatario d ON d.notificacion_id = n.id
        ${joinsEnriquecidos}
        WHERE ${whereClause}
    `, params);

    const total = Number(countResult.rows[0].total);

    const result = await db.query(`
        SELECT n.id, n.evento_clave, n.tipo, n.titulo, n.mensaje, n.planta_key,
               n.empresa_key, n.entidad_tipo, n.entidad_id, n.destino_navegacion,
               n.fecha_creacion, d.leida, d.fecha_lectura,
               s.estado AS estado_solicitud,
               s.tipo_operacion AS solicitud_tipo_operacion,
               s.id AS solicitud_id,
               s.usuario_solicitante AS solicitante_username,
               COALESCE(
                   NULLIF(BTRIM(CONCAT_WS(' ', ps.nombres, ps.apellidos)), ''),
                   NULLIF(BTRIM(ps.nombrerazonsocial), ''),
                   s.usuario_solicitante
               ) AS solicitante_nombre,
               s.usuario_decision AS autorizador_username,
               COALESCE(
                   NULLIF(BTRIM(CONCAT_WS(' ', pd.nombres, pd.apellidos)), ''),
                   NULLIF(BTRIM(pd.nombrerazonsocial), ''),
                   s.usuario_decision
               ) AS autorizador_nombre,
               s.fecha_decision AS fecha_decision,
               s.motivo AS sustento_solicitud,
               s.justificacion_decision AS justificacion_decision,
               s.datos_propuestos ->> 'motivoCodigo' AS motivo_nota_codigo,
               EXISTS (
                   SELECT 1
                   FROM fg_solicitud_operacion_evento se
                   WHERE se.solicitud_id = s.id
                     AND se.tipo_evento = 'SOLICITUD_APROBADA'
                     AND se.metadatos ->> 'autoaprobacion' = 'true'
               ) AS autoaprobacion_excepcional,
               s.certificado_id AS certificado_id,
               c.numero_certificado AS certificado_numero,
               f.nro_comprobante AS comprobante_numero,
               f.tipo_comprobante AS tipo_comprobante,
               pl.nombre AS planta_nombre
        FROM fg_notificacion n
        JOIN fg_notificacion_destinatario d ON d.notificacion_id = n.id
        ${joinsEnriquecidos}
        WHERE ${whereClause}
        ORDER BY n.fecha_creacion DESC
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `, [...params, limite, offset]);

    return {
        data: result.rows,
        total,
        pagina,
        limite,
        totalPaginas: Math.ceil(total / limite)
    };
};

/**
 * Lista las notificaciones de un usuario autenticado.
 * El usuario se obtiene del contexto autenticado, nunca de un ID enviado por el frontend.
 *
 * Las notificaciones de tipo SOLICITUD_PENDIENTE_APROBACION vinculadas a una solicitud
 * administrativa ya atendida (estado distinto de PENDIENTE_APROBACION) se excluyen del
 * listado, aunque no se eliminen físicamente de la base de datos (se conservan para
 * auditoría). Las notificaciones informativas al solicitante (aprobada/rechazada) no se
 * ven afectadas porque su tipo es diferente.
 */
const listar = async (usuarioId, executor) => {
    if (!usuarioId) throw errorNegocio('USUARIO_REQUERIDO', 401);
    if (!executor) throw errorNegocio('EXECUTOR_REQUERIDO', 500);
    const db = executor;

    const result = await db.query(`
        SELECT n.id, n.evento_clave, n.tipo, n.titulo, n.mensaje, n.planta_key,
               n.empresa_key, n.entidad_tipo, n.entidad_id, n.destino_navegacion,
               n.fecha_creacion, d.leida, d.fecha_lectura,
               s.tipo_operacion AS solicitud_tipo_operacion,
               s.estado AS estado_solicitud,
               s.usuario_solicitante AS solicitante_nombre,
               s.usuario_decision AS autorizador_nombre,
               s.fecha_decision AS fecha_decision,
               s.motivo AS sustento_solicitud,
               s.certificado_id AS certificado_id,
               c.numero_certificado AS certificado_numero,
               f.nro_comprobante AS comprobante_numero,
               f.tipo_comprobante AS tipo_comprobante
        FROM fg_notificacion n
        JOIN fg_notificacion_destinatario d ON d.notificacion_id = n.id
        LEFT JOIN fg_solicitud_operacion s
            ON s.id = n.entidad_id
           AND n.entidad_tipo = 'SOLICITUD_OPERACION'
        LEFT JOIN fg_certificado c ON c.id = s.certificado_id
        LEFT JOIN fg_facturacion f ON f.id = s.facturacion_id
        WHERE d.usuario_id = $1
          AND (
              -- Solo notificaciones que requieren atención (tareas pendientes)
              n.tipo = 'SOLICITUD_PENDIENTE_APROBACION'
              AND n.entidad_tipo = 'SOLICITUD_OPERACION'
              AND (s.estado IS NULL OR s.estado = 'PENDIENTE_APROBACION')
          )
        ORDER BY n.fecha_creacion DESC
        LIMIT 50
    `, [usuarioId]);

    return result.rows;
};

/**
 * Cuenta las notificaciones sin leer de un usuario autenticado.
 *
 * Las notificaciones de tipo SOLICITUD_PENDIENTE_APROBACION vinculadas a una solicitud
 * administrativa ya atendida (estado distinto de PENDIENTE_APROBACION) se excluyen del
 * conteo, aunque no se eliminen físicamente de la base de datos.
 */
const contarNoLeidas = async (usuarioId, executor) => {
    if (!usuarioId) throw errorNegocio('USUARIO_REQUERIDO', 401);
    if (!executor) throw errorNegocio('EXECUTOR_REQUERIDO', 500);
    const db = executor;

    const result = await db.query(`
        SELECT COUNT(*)::int AS c
        FROM fg_notificacion_destinatario d
        JOIN fg_notificacion n ON n.id = d.notificacion_id
        LEFT JOIN fg_solicitud_operacion s
            ON s.id = n.entidad_id
           AND n.entidad_tipo = 'SOLICITUD_OPERACION'
        WHERE d.usuario_id = $1 AND d.leida = FALSE
          AND (
              n.tipo = 'SOLICITUD_PENDIENTE_APROBACION'
              AND n.entidad_tipo = 'SOLICITUD_OPERACION'
              AND (s.estado IS NULL OR s.estado = 'PENDIENTE_APROBACION')
          )
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

let _io = null;

const setSocketIO = (io) => {
    _io = io;
};

const emitirNotificacionActualizada = (plantaKey, empresaKey) => {
    if (_io) {
        _io.emit('notificacionActualizada', { plantaKey, empresaKey });
    }
};

module.exports = {
    crear,
    crearParaSolicitud,
    crearParaAutorizacionNotaCredito,
    crearParaSolicitante,
    obtenerDestinatariosPorPlanta,
    listar,
    listarHistorial,
    contarNoLeidas,
    marcarLeida,
    marcarTodasLeidas,
    setSocketIO,
    emitirNotificacionActualizada,
    _private: { errorNegocio }
};
