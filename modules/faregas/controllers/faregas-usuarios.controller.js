const service = require('../services/faregas-usuarios.service');
const auditoriaService = require('../services/faregas-auditoria.service');

const contextoAuditoria = (req) => auditoriaService.contextoRequest(req);

const responderErrorPerfil = (res, e) => {
    const status = Number(e?.statusCode) || 500;
    if (status !== 500) {
        return res.status(status).json({
            success: false,
            codigo: e.code,
            message: e.message,
            ...(e.detalles !== undefined ? { detalles: e.detalles } : {})
        });
    }
    console.error(e);
    return res.status(500).json({ message: 'Error interno del servidor' });
};

exports.obtenerUsuariosPaginado = async (req, res) => {
    try {
        const resultado = await service.obtenerUsuariosPaginado({
            buscar: req.query.buscar,
            perfil_id: req.query.perfil_id,
            estado: req.query.estado === 'true' ? true : req.query.estado === 'false' ? false : undefined,
            page: req.query.page,
            pageSize: req.query.pageSize ?? req.query.limite
        });
        res.json({ success: true, ...resultado });
    } catch (error) {
        console.error('Error en obtenerUsuariosPaginado FAREGAS:', error);
        res.status(500).json({ success: false, message: 'Error al obtener usuarios.' });
    }
};

exports.obtenerUsuarios = async (req, res) => {
    try {
        const data = await service.obtenerUsuarios();
        res.json(data);
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Error interno del servidor' });
    }
};

exports.crearUsuario = async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) return res.status(400).json({ message: 'Username y password requeridos' });
        
        const result = await service.crearUsuario(req.body, req.user.username);

        // Registro de auditoría
        await auditoriaService.registrarEvento({
            ...contextoAuditoria(req),
            categoria: 'USUARIOS',
            modulo: 'USUARIOS',
            evento: 'USUARIO_CREADO',
            mensaje: `Usuario ${result.username} creado con perfil ${result.perfil_id || req.body.perfil_id}`,
            entidad: 'fg_usuario',
            documento_referencia: result.username,
            datos: { perfil_id: result.perfil_id || req.body.perfil_id, estado: result.estado ?? true }
        });

        res.status(201).json(result);
    } catch (e) {
        if (e.code === 'MIGRACION_PERFIL_FAREGAS_PENDIENTE') {
            return res.status(503).json({ message: e.message, codigo: e.code });
        }
        if (e.code === 'DATOS_USUARIO_INVALIDOS') {
            return res.status(400).json({ message: e.message, errores: e.errores });
        }
        if (e.code === 'PERSONA_FARENET_NO_EXISTE' || e.code === 'PERFIL_PERSONA_FARENET_SOLO_LECTURA') {
            return res.status(409).json({
                message: e.message,
                ...(e.detalles?.length ? { campos: e.detalles } : {})
            });
        }
        if (e.code === '23505') { // unique_violation
            return res.status(409).json({ message: 'El usuario o n�mero de documento ya existe' });
        }
        console.error(e);
        res.status(500).json({ message: 'Error interno del servidor' });
    }
};

exports.actualizarUsuario = async (req, res) => {
    try {
        const usuarioObjetivo = req.params.username;
        if (req.user.username === usuarioObjetivo && req.body.estado === false) {
            return res.status(409).json({ message: 'No puedes desactivar tu propio usuario mientras tienes una sesi�n activa.' });
        }
        
        const result = await service.actualizarUsuario(usuarioObjetivo, req.body, req.user.username);

        // Registro de auditoría
        await auditoriaService.registrarEvento({
            ...contextoAuditoria(req),
            categoria: 'USUARIOS',
            modulo: 'USUARIOS',
            evento: req.body.estado === false ? 'USUARIO_DESACTIVADO' : 'USUARIO_ACTUALIZADO',
            mensaje: `Usuario ${usuarioObjetivo} actualizado${req.body.estado === false ? ' (Desactivado)' : ''}`,
            entidad: 'fg_usuario',
            documento_referencia: usuarioObjetivo,
            datos: { perfil_id: req.body.perfil_id, estado: req.body.estado }
        });

        res.json(result);
    } catch (e) {
        if (e.code === 'MIGRACION_PERFIL_FAREGAS_PENDIENTE') {
            return res.status(503).json({ message: e.message, codigo: e.code });
        }
        if (e.code === 'DATOS_USUARIO_INVALIDOS') {
            return res.status(400).json({ message: e.message, errores: e.errores });
        }
        if (e.code === 'PERSONA_FARENET_NO_EXISTE' || e.code === 'PERFIL_PERSONA_FARENET_SOLO_LECTURA') {
            return res.status(409).json({
                message: e.message,
                ...(e.detalles?.length ? { campos: e.detalles } : {})
            });
        }
        if (e.message === 'USERNAME_EXISTS') {
            return res.status(409).json({ message: 'El nuevo username ya est� en uso' });
        }
        if (e.code === '23505') { // unique_violation for DNI etc
            return res.status(409).json({ message: 'El n�mero de documento ya existe en otro registro' });
        }
        console.error(e);
        res.status(500).json({ message: 'Error interno del servidor' });
    }
};

exports.cambiarPassword = async (req, res) => {
    try {
        const { password } = req.body;
        if (!password) return res.status(400).json({ message: 'Nueva contrase�a requerida' });
        await service.cambiarPassword(req.params.username, password);

        // Registro de auditoría (SIN registrar la contraseña)
        await auditoriaService.registrarEvento({
            ...contextoAuditoria(req),
            categoria: 'USUARIOS',
            modulo: 'USUARIOS',
            evento: 'PASSWORD_ACTUALIZADO',
            mensaje: `Contraseña administrativa restablecida para usuario ${req.params.username}`,
            entidad: 'fg_usuario',
            documento_referencia: req.params.username
        });

        res.json({ success: true });
    } catch (e) {
        if (e.message === 'USER_NOT_FOUND') {
            return res.status(404).json({ message: 'El usuario no existe' });
        }
        console.error(e);
        res.status(500).json({ message: 'Error interno del servidor' });
    }
};

exports.eliminarUsuario = async (req, res) => {
    try {
        const usuarioObjetivo = req.params.username;
        if (req.user.username === usuarioObjetivo) {
            return res.status(409).json({ message: 'No puedes eliminar tu propio usuario mientras tienes una sesión activa.' });
        }

        const resultado = await service.eliminarUsuario(usuarioObjetivo);

        // Registro de auditoría
        await auditoriaService.registrarEvento({
            ...contextoAuditoria(req),
            categoria: 'USUARIOS',
            modulo: 'USUARIOS',
            evento: 'USUARIO_ELIMINADO',
            mensaje: `Usuario ${usuarioObjetivo} eliminado del sistema`,
            entidad: 'fg_usuario',
            documento_referencia: usuarioObjetivo
        });

        return res.json({
            success: true,
            username: resultado?.username ?? usuarioObjetivo,
            // Las sesiones se cierran solas; se informa cuántas para que el
            // operador no las busque después.
            sesiones_cerradas: resultado?.sesionesCerradas ?? 0
        });
    } catch (e) {
        // El historial de negocio se detecta antes del DELETE, así que el
        // servicio responde 409 con el detalle de qué lo bloquea. Este camino
        // cubre además el 23503 que devolviera la base de datos, para no
        // degradarlo a un 500 genérico.
        const historialPorServicio = e.code === 'USUARIO_CON_HISTORIAL';
        const historialPorFk = e.code === '23503';
        if (historialPorServicio || historialPorFk) {
            const bloqueos = e.bloqueos || [];
            const detalle = bloqueos.length
                ? `tiene ${bloqueos.map((b) => `${b.total} ${b.etiqueta}`).join(', ')}.`
                : 'tiene historial asociado.';
            return res.status(409).json({
                message: `No se puede eliminar el usuario porque ${detalle}`,
                usuario: e.username ?? req.params.username,
                bloqueos
            });
        }
        console.error(e);
        return res.status(500).json({ message: 'Error interno del servidor' });
    }
};

exports.obtenerPerfiles = async (req, res) => {
    try {
        const data = await service.obtenerPerfiles();
        res.json(data);
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Error interno del servidor' });
    }
};

exports.obtenerPermisos = async (req, res) => {
    try {
        const data = await service.obtenerPermisos();
        res.json(data);
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Error interno del servidor' });
    }
};

exports.crearPerfil = async (req, res) => {
    try {
        const { clave, nombre } = req.body;
        if (!clave || !nombre) return res.status(400).json({ message: 'Clave y nombre requeridos' });
        const result = await service.crearPerfil(req.body, req.user, contextoAuditoria(req));
        res.status(201).json(result);
    } catch (e) {
        if (e.code === '23505') return res.status(409).json({ message: 'La clave de perfil ya existe' });
        return responderErrorPerfil(res, e);
    }
};

exports.actualizarPerfil = async (req, res) => {
    try {
        const result = await service.actualizarPerfil(
            req.params.clave,
            req.body,
            req.user,
            contextoAuditoria(req)
        );
        res.json(result);
    } catch (e) {
        return responderErrorPerfil(res, e);
    }
};

exports.eliminarPerfil = async (req, res) => {
    try {
        await service.eliminarPerfil(req.params.clave);
        res.json({ success: true });
    } catch (e) {
        if (e.message === 'NO_DELETE_SISTEMAS') {
            return res.status(403).json({ message: 'No se permite eliminar el perfil SISTEMAS' });
        }
        if (e.message === 'IN_USE') {
            return res.status(409).json({ message: 'No se puede eliminar el perfil porque tiene usuarios asignados.' });
        }
        console.error(e);
        res.status(500).json({ message: 'Error interno del servidor' });
    }
};

exports.obtenerPlantas = async (req, res) => {
    try {
        const data = await service.obtenerPlantas();
        res.json(data);
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Error interno del servidor' });
    }
};

exports.getMaestrosPersona = async (req, res) => {
    try {
        const data = await service.getMaestrosPersona();
        res.json(data);
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Error interno del servidor' });
    }
};

exports.getDepartamentos = async (req, res) => {
    try {
        const data = await service.getDepartamentos(req.params.paisKey);
        res.json(data);
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Error interno del servidor' });
    }
};

exports.getProvincias = async (req, res) => {
    try {
        const data = await service.getProvincias(req.params.departamentoKey);
        res.json(data);
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Error interno del servidor' });
    }
};

exports.getDistritos = async (req, res) => {
    try {
        const data = await service.getDistritos(req.params.provinciaKey);
        res.json(data);
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Error interno del servidor' });
    }
};

