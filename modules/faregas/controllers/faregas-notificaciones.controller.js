const notificacionesService = require('../services/faregas-notificaciones.service');
const db = require('../../../config/database');

const responderJson = (res, status, body) => res.status(status).json(body);

/**
 * Listar notificaciones del usuario autenticado.
 * El usuario se obtiene de req.user (establecido por el middleware de autenticación),
 * nunca de un ID enviado por el frontend.
 */
exports.listar = async (req, res) => {
    try {
        const usuarioId = String(req.user?.username || '').trim();
        if (!usuarioId) {
            return responderJson(res, 401, { ok: false, codigo: 'USUARIO_NO_AUTENTICADO', message: 'Usuario no autenticado.' });
        }
        const data = await notificacionesService.listar(usuarioId, db);
        return res.json({ ok: true, data });
    } catch (error) {
        return responderJson(res, error.statusCode || 500, { ok: false, codigo: error.code || 'ERROR_INTERNO', message: error.message || 'Error interno.' });
    }
};

/**
 * Contar notificaciones sin leer del usuario autenticado.
 */
exports.contarSinLeer = async (req, res) => {
    try {
        const usuarioId = String(req.user?.username || '').trim();
        if (!usuarioId) {
            return responderJson(res, 401, { ok: false, codigo: 'USUARIO_NO_AUTENTICADO', message: 'Usuario no autenticado.' });
        }
        const count = await notificacionesService.contarNoLeidas(usuarioId, db);
        return res.json({ ok: true, count });
    } catch (error) {
        return responderJson(res, error.statusCode || 500, { ok: false, codigo: error.code || 'ERROR_INTERNO', message: error.message || 'Error interno.' });
    }
};

/**
 * Marcar una notificación como leída para el usuario autenticado.
 */
exports.marcarLeida = async (req, res) => {
    try {
        const usuarioId = String(req.user?.username || '').trim();
        if (!usuarioId) {
            return responderJson(res, 401, { ok: false, codigo: 'USUARIO_NO_AUTENTICADO', message: 'Usuario no autenticado.' });
        }
        const notificacionId = Number(req.params.id);
        if (!notificacionId) {
            return responderJson(res, 400, { ok: false, codigo: 'NOTIFICACION_REQUERIDA', message: 'ID de notificación requerido.' });
        }
        const marcada = await notificacionesService.marcarLeida(usuarioId, notificacionId, db);
        return res.json({ ok: true, marcada });
    } catch (error) {
        return responderJson(res, error.statusCode || 500, { ok: false, codigo: error.code || 'ERROR_INTERNO', message: error.message || 'Error interno.' });
    }
};

/**
 * Marcar todas las notificaciones como leídas para el usuario autenticado.
 */
exports.marcarTodasLeidas = async (req, res) => {
    try {
        const usuarioId = String(req.user?.username || '').trim();
        if (!usuarioId) {
            return responderJson(res, 401, { ok: false, codigo: 'USUARIO_NO_AUTENTICADO', message: 'Usuario no autenticado.' });
        }
        await notificacionesService.marcarTodasLeidas(usuarioId, db);
        return res.json({ ok: true });
    } catch (error) {
        return responderJson(res, error.statusCode || 500, { ok: false, codigo: error.code || 'ERROR_INTERNO', message: error.message || 'Error interno.' });
    }
};
