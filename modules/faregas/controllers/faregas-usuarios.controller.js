const fs = require('fs');
const path = require('path');
const db = require('../../../config/database');
const service = require('../services/faregas-usuarios.service');
const authService = require('../services/faregas-auth.service');
const custodiaService = require('../services/faregas-credencial-custodia.service');
const credencialesTemporalesService = require('../services/faregas-credenciales-temporales.service');
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

        if (req.body.password) {
            await auditoriaService.registrarEvento({
                ...contextoAuditoria(req),
                categoria: 'USUARIOS',
                modulo: 'USUARIOS',
                evento: 'PASSWORD_ACTUALIZADO',
                mensaje: `Contraseña inicial asignada para usuario ${result.username} por ${req.user?.username || 'ADMIN'}`,
                entidad: 'fg_usuario',
                documento_referencia: result.username,
                datos: {
                    usuario: result.username,
                    responsable: req.user?.username || 'ADMIN',
                    tipo: 'CREACION_USUARIO'
                }
            });
        }

        res.status(201).json(result);
    } catch (e) {
        if (e.code === 'USUARIO_PROTEGIDO') {
            return res.status(403).json({ message: e.message, codigo: e.code });
        }
        if (e.code === 'SEDE_NO_PERMITIDA_PARA_PERFIL' || e.code === 'POLITICA_PASSWORD_INVALIDA') {
            return res.status(400).json({ message: e.message, codigo: e.code });
        }
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
        if (e.code === 'USUARIO_DUPLICADO_INACTIVO' || e.code === 'USUARIO_DUPLICADO_ACTIVO' || e.code === 'DOCUMENTO_DUPLICADO') {
            return res.status(409).json({
                message: e.message,
                codigo: e.code,
                username: e.username,
                nroDocumento: e.nroDocumento
            });
        }
        if (e.code === '23505') { // unique_violation fallback
            if (e.constraint === 'uq_fg_usuario_perfil_documento') {
                return res.status(409).json({
                    message: 'El número de documento ya está registrado para otro usuario. Verifique los datos ingresados.',
                    codigo: 'DOCUMENTO_DUPLICADO'
                });
            }
            return res.status(409).json({
                message: 'El usuario ya existe en el sistema.',
                codigo: 'USUARIO_DUPLICADO'
            });
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

        if (req.body.password) {
            await auditoriaService.registrarEvento({
                ...contextoAuditoria(req),
                categoria: 'USUARIOS',
                modulo: 'USUARIOS',
                evento: 'PASSWORD_ACTUALIZADO',
                mensaje: `Contraseña administrativa restablecida para usuario ${usuarioObjetivo} por ${req.user?.username || 'ADMIN'}`,
                entidad: 'fg_usuario',
                documento_referencia: usuarioObjetivo,
                datos: {
                    usuario: usuarioObjetivo,
                    responsable: req.user?.username || 'ADMIN',
                    tipo: 'RESTABLECIMIENTO_INDIVIDUAL'
                }
            });
        }

        res.json(result);
    } catch (e) {
        if (e.code === 'USUARIO_PROTEGIDO') {
            return res.status(403).json({ message: e.message, codigo: e.code });
        }
        if (e.code === 'SEDE_NO_PERMITIDA_PARA_PERFIL' || e.code === 'POLITICA_PASSWORD_INVALIDA') {
            return res.status(400).json({ message: e.message, codigo: e.code });
        }
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
        if (e.code === 'USUARIO_DUPLICADO_INACTIVO' || e.code === 'USUARIO_DUPLICADO_ACTIVO' || e.code === 'DOCUMENTO_DUPLICADO') {
            return res.status(409).json({
                message: e.message,
                codigo: e.code,
                username: e.username,
                nroDocumento: e.nroDocumento
            });
        }
        if (e.message === 'USERNAME_EXISTS') {
            return res.status(409).json({ message: 'El nuevo username ya está en uso', codigo: 'USUARIO_DUPLICADO_ACTIVO' });
        }
        if (e.code === '23505') { // unique_violation for DNI etc
            return res.status(409).json({
                message: 'El número de documento ya está registrado para otro usuario. Verifique los datos ingresados.',
                codigo: 'DOCUMENTO_DUPLICADO'
            });
        }
        console.error(e);
        res.status(500).json({ message: 'Error interno del servidor' });
    }
};

exports.cambiarPassword = async (req, res) => {
    try {
        const { password, confirmPassword } = req.body;
        if (!password) return res.status(400).json({ message: 'Nueva contraseña requerida' });
        if (confirmPassword !== undefined && confirmPassword !== password) {
            return res.status(400).json({ codigo: 'CONFIRMACION_NO_COINCIDE', message: 'Las contraseñas no coinciden' });
        }
        await service.cambiarPassword(req.params.username, password, {
            opciones: { responsable: req.user?.username || 'ADMIN' }
        });

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
        if (e.code === 'POLITICA_PASSWORD_INVALIDA' || e.statusCode === 400) {
            return res.status(400).json({ codigo: e.code || 'POLITICA_PASSWORD_INVALIDA', message: e.message });
        }
        console.error(e);
        res.status(500).json({ message: 'Error interno del servidor' });
    }
};

exports.obtenerPoliticaPassword = async (_req, res) => {
    try {
        const authService = require('../services/faregas-auth.service');
        const politica = authService.obtenerConfiguracionPolitica();
        res.json(politica);
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Error al obtener política de contraseña' });
    }
};

exports.restablecerCredencialesTemporales = async (req, res) => {
    try {
        const resultados = await credencialesTemporalesService.restablecerCredencialesTemporales(
            req.body?.credenciales,
        );

        // El middleware de auditoría solo recibe identificadores y conteos; las
        // contraseñas no se agregan a req, respuesta, mensajes ni metadatos.
        req.usuariosCredencialesRestablecidas = resultados.map(({ username }) => username);
        for (const resultado of resultados) {
            await auditoriaService.registrarEvento({
                ...contextoAuditoria(req),
                categoria: 'SEGURIDAD',
                modulo: 'USUARIOS',
                evento: 'CREDENCIAL_TEMPORAL_RESTABLECIDA',
                mensaje: `Se restableció la contraseña temporal de ${resultado.username}.`,
                entidad: 'fg_usuario',
                documento_referencia: resultado.username,
                datos: { sesiones_revocadas: resultado.sesionesRevocadas },
            });
        }

        return res.json({ success: true, resultados });
    } catch (error) {
        const status = Number(error?.statusCode) || 500;
        if (status < 500) {
            return res.status(status).json({
                success: false,
                codigo: error.code,
                message: error.message,
            });
        }
        // No registrar el request ni el body: puede contener contraseñas nuevas.
        console.error('Error restableciendo credenciales temporales FAREGAS:', error.code || error.name);
        return res.status(500).json({
            success: false,
            message: 'No se pudo confirmar el restablecimiento de credenciales.',
        });
    }
};

exports.generarCredencialTemporal = async (req, res) => {
    try {
        const username = req.params.username;
        if (String(username).trim().toLowerCase() === 'gibarra') {
            return res.status(403).json({
                message: 'El usuario gibarra es una cuenta administrativa protegida y su credencial no puede ser modificada.',
                codigo: 'USUARIO_PROTEGIDO'
            });
        }

        const resultado = await service.generarCredencialTemporal(username, req.user?.username || 'ADMIN');

        await auditoriaService.registrarEvento({
            ...contextoAuditoria(req),
            categoria: 'USUARIOS',
            modulo: 'USUARIOS',
            evento: 'PASSWORD_ACTUALIZADO',
            mensaje: `Generación de contraseña temporal administrativa para ${username} por ${req.user?.username || 'ADMIN'}`,
            entidad: 'fg_usuario',
            documento_referencia: username,
            datos: {
                usuario: username,
                responsable: req.user?.username || 'ADMIN',
                tipo: 'CREDENCIAL_TEMPORAL_INDIVIDUAL'
            }
        });

        res.json({ success: true, ...resultado });
    } catch (e) {
        if (e.code === 'USUARIO_PROTEGIDO') {
            return res.status(403).json({ message: e.message, codigo: e.code });
        }
        if (e.message === 'USER_NOT_FOUND') {
            return res.status(404).json({ message: 'El usuario no existe' });
        }
        console.error('Error al generar credencial temporal:', e);
        res.status(500).json({ message: 'Error interno al generar credencial temporal.' });
    }
};

exports.consultarCredencialAsignada = async (req, res) => {
    try {
        const username = req.params.username;
        const resultado = await service.consultarCredencialAsignada(username);

        await auditoriaService.registrarEvento({
            ...contextoAuditoria(req),
            categoria: 'USUARIOS',
            modulo: 'USUARIOS',
            evento: 'CREDENCIAL_CONSULTADA',
            mensaje: `Consulta administrativa de credencial para ${username}: ${resultado.vigente ? 'VIGENTE' : (resultado.motivo || 'NO DISPONIBLE')}`,
            entidad: 'fg_usuario',
            documento_referencia: username
        });

        res.json({ success: true, ...resultado });
    } catch (e) {
        console.error('Error al consultar credencial asignada:', e);
        res.status(500).json({ message: 'Error interno al consultar la credencial asignada.' });
    }
};

exports.revelarCredencialCustodiada = async (req, res) => {
    try {
        const username = String(req.params.username || '').trim();
        const cleanUsername = username.toLowerCase();
        const adminUsername = req.user?.username;
        const passwordAdmin = req.body?.passwordAdmin;

        if (cleanUsername === 'gibarra') {
            return res.status(403).json({
                message: 'El usuario gibarra es una cuenta administrativa protegida y no puede ser revelado.',
                codigo: 'USUARIO_PROTEGIDO'
            });
        }

        // 1. Rate limiting estricto anti-scraping
        custodiaService.verificarLimiteRevelaciones(adminUsername || req.ip);

        // 2. Reautenticación obligatoria del administrador en sesión
        if (!passwordAdmin || typeof passwordAdmin !== 'string') {
            return res.status(400).json({
                message: 'Debe ingresar su contraseña de administrador para confirmar la revelación de la credencial.',
                codigo: 'PASSWORD_ADMIN_REQUERIDA'
            });
        }

        const authValido = await authService.validarFaregas(adminUsername, passwordAdmin);
        if (!authValido?.valido) {
            await auditoriaService.registrarEvento({
                ...contextoAuditoria(req),
                categoria: 'USUARIOS',
                modulo: 'USUARIOS',
                evento: 'CREDENCIAL_REVELACION_FALLIDA',
                mensaje: `Reautenticación fallida al intentar revelar credencial de ${username}. Contraseña de administrador incorrecta.`,
                entidad: 'fg_usuario',
                documento_referencia: username
            });
            return res.status(401).json({
                message: 'Contraseña de administrador incorrecta. No se puede revelar la credencial.',
                codigo: 'REAUTENTICACION_FALLIDA'
            });
        }

        // 3. Descifrar credencial bajo custodia
        const credencial = await custodiaService.obtenerCredencialDescifrada(db, cleanUsername);

        // 4. Auditoría inmutable de revelación (SIN registrar la contraseña)
        await auditoriaService.registrarEvento({
            ...contextoAuditoria(req),
            categoria: 'USUARIOS',
            modulo: 'USUARIOS',
            evento: 'CREDENCIAL_REVELADA',
            mensaje: `El administrador ${adminUsername} reveló la credencial administrada custodiada del usuario ${username}.`,
            entidad: 'fg_usuario',
            documento_referencia: username
        });

        // 5. Encabezados de no caché
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');

        return res.json({
            success: true,
            username: credencial.username,
            password: credencial.password,
            creadoPor: credencial.creadoPor,
            fechaActualizacion: credencial.fechaActualizacion
        });
    } catch (e) {
        if (e.code === 'LIMITE_CONSULTAS_EXCEDIDO') {
            return res.status(429).json({ message: e.message, codigo: e.code });
        }
        if (e.code === 'CREDENCIAL_NO_CUSTODIADA') {
            return res.status(404).json({ message: e.message, codigo: e.code });
        }
        if (e.code === 'USUARIO_PROTEGIDO') {
            return res.status(403).json({ message: e.message, codigo: e.code });
        }
        console.error('Error al revelar credencial custodiada:', e);
        return res.status(500).json({ message: 'Error interno al revelar la credencial custodiada.' });
    }
};

exports.descargarInventarioRenovado = async (req, res) => {
    try {
        const buffer = await service.generarBufferExcelInventario({
            solicitante: req.user?.username || 'ADMINISTRADOR',
            fechaGeneracion: new Date().toLocaleString('es-PE', { timeZone: 'America/Lima' })
        });

        await auditoriaService.registrarEvento({
            ...contextoAuditoria(req),
            categoria: 'USUARIOS',
            modulo: 'USUARIOS',
            evento: 'INVENTARIO_CREDENCIALES_DESCARGADO',
            mensaje: `Descarga administrativa del inventario dinámico de credenciales por ${req.user.username}`,
            entidad: 'fg_usuario',
            documento_referencia: 'faregas_credenciales_renovadas.xlsx'
        });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="faregas_credenciales_renovadas.xlsx"');
        res.send(buffer);
    } catch (e) {
        console.error('Error al generar inventario de credenciales:', e);
        res.status(500).json({ message: 'Error interno al generar el inventario de credenciales.' });
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
            evento: resultado?.accion === 'DESACTIVADO' ? 'USUARIO_DESACTIVADO' : 'USUARIO_ELIMINADO',
            mensaje: resultado?.accion === 'DESACTIVADO'
                ? `Usuario ${usuarioObjetivo} desactivado preventivamente por contar con historial operativo`
                : `Usuario ${usuarioObjetivo} eliminado del sistema`,
            entidad: 'fg_usuario',
            documento_referencia: usuarioObjetivo,
            datos: resultado
        });

        return res.json({
            success: true,
            ...resultado
        });
    } catch (e) {
        if (e.code === 'AUTO_ELIMINACION_PROHIBIDA') {
            return res.status(409).json({ message: e.message });
        }
        if (e.code === 'ULTIMO_ADMIN') {
            return res.status(403).json({ message: e.message });
        }
        if (e.message === 'USER_NOT_FOUND' || e.code === 'USER_NOT_FOUND') {
            return res.status(404).json({ message: 'El usuario no existe' });
        }
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

exports.desactivarUsuario = async (req, res) => {
    try {
        const usuarioObjetivo = req.params.username;
        if (req.user.username === usuarioObjetivo) {
            return res.status(409).json({ message: 'No puedes desactivar tu propio usuario mientras tienes una sesión activa.' });
        }
        const resultado = await service.desactivarUsuario(usuarioObjetivo);

        await auditoriaService.registrarEvento({
            ...contextoAuditoria(req),
            categoria: 'USUARIOS',
            modulo: 'USUARIOS',
            evento: 'USUARIO_DESACTIVADO',
            mensaje: `Usuario ${usuarioObjetivo} desactivado administrativamente`,
            entidad: 'fg_usuario',
            documento_referencia: usuarioObjetivo
        });

        res.json({ success: true, ...resultado });
    } catch (e) {
        if (e.code === 'USER_NOT_FOUND') return res.status(404).json({ message: 'El usuario no existe.' });
        if (e.code === 'ULTIMO_ADMIN') return res.status(403).json({ message: e.message });
        console.error(e);
        res.status(500).json({ message: 'Error interno del servidor' });
    }
};

exports.activarUsuario = async (req, res) => {
    try {
        const usuarioObjetivo = req.params.username;
        const resultado = await service.activarUsuario(usuarioObjetivo);

        await auditoriaService.registrarEvento({
            ...contextoAuditoria(req),
            categoria: 'USUARIOS',
            modulo: 'USUARIOS',
            evento: 'USUARIO_ACTIVADO',
            mensaje: `Usuario ${usuarioObjetivo} reactivado`,
            entidad: 'fg_usuario',
            documento_referencia: usuarioObjetivo
        });

        res.json({ success: true, ...resultado });
    } catch (e) {
        if (e.code === 'USER_NOT_FOUND') return res.status(404).json({ message: 'El usuario no existe.' });
        console.error(e);
        res.status(500).json({ message: 'Error interno del servidor' });
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

exports.obtenerUsuariosPorPerfil = async (req, res) => {
    try {
        const usuarios = await service.obtenerUsuariosPorPerfil(req.params.clave);
        res.json({
            success: true,
            perfil: req.params.clave,
            usuarios,
            totalUsuarios: usuarios.length
        });
    } catch (e) {
        if (e.code === 'PERFIL_NO_EXISTE') {
            return res.status(404).json({ success: false, message: e.message });
        }
        console.error(e);
        res.status(500).json({ success: false, message: 'Error interno del servidor' });
    }
};

exports.eliminarPerfil = async (req, res) => {
    try {
        const { nuevoPerfilClave } = req.body || {};
        const clave = req.params.clave;
        const resultado = await service.eliminarPerfil(clave, { nuevoPerfilClave });

        // Auditoría
        await auditoriaService.registrarEvento({
            ...contextoAuditoria(req),
            categoria: 'PERFILES',
            modulo: 'USUARIOS',
            evento: 'PERFIL_ELIMINADO',
            mensaje: `Perfil ${clave} eliminado${resultado.usuariosReasignados > 0 ? ` (Reasignados ${resultado.usuariosReasignados} usuarios a ${resultado.nuevoPerfilClave})` : ''}`,
            entidad: 'fg_perfil',
            documento_referencia: clave,
            datos: resultado
        });

        res.json({ success: true, ...resultado });
    } catch (e) {
        if (e.code === 'NO_DELETE_SISTEMAS' || e.message === 'NO_DELETE_SISTEMAS') {
            return res.status(403).json({ success: false, codigo: 'NO_DELETE_SISTEMAS', message: 'No se permite eliminar el perfil base SISTEMAS.' });
        }
        if (e.code === 'ULTIMO_ADMIN_PERFIL') {
            return res.status(403).json({ success: false, codigo: 'ULTIMO_ADMIN_PERFIL', message: e.message });
        }
        if (e.code === 'PERFIL_NO_EXISTE') {
            return res.status(404).json({ success: false, codigo: 'PERFIL_NO_EXISTE', message: e.message });
        }
        if (e.code === 'PERFIL_CON_USUARIOS') {
            return res.status(409).json({
                success: false,
                codigo: 'PERFIL_CON_USUARIOS',
                message: e.message,
                perfil: e.perfil || req.params.clave,
                usuarios: e.usuarios || [],
                totalUsuarios: e.usuarios?.length || 0
            });
        }
        if (e.code === 'PERFIL_REEMPLAZO_REQUERIDO' || e.code === 'PERFIL_REEMPLAZO_INVALIDO') {
            return res.status(400).json({ success: false, codigo: e.code, message: e.message });
        }
        if (e.message === 'IN_USE') {
            return res.status(409).json({ success: false, message: 'No se puede eliminar el perfil porque tiene usuarios asignados.' });
        }
        console.error(e);
        res.status(500).json({ success: false, message: 'Error interno del servidor' });
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

