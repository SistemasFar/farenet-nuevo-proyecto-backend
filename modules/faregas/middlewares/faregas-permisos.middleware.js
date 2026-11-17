const { cargarContextoPermisosFaregas, tienePermisoFaregas } = require('../services/faregas-autorizacion-permisos.service');

const CONTEXTO_PERMISOS = Symbol.for('faregas.contexto-permisos');

const obtenerContextoRequest = (db, req) => {
    if (!req[CONTEXTO_PERMISOS]) {
        req[CONTEXTO_PERMISOS] = cargarContextoPermisosFaregas(db, req.user?.username);
    }
    return req[CONTEXTO_PERMISOS];
};

const crearMiddlewarePermisoFaregas = (db, {
    anyOf = [],
    allOf = [],
    message = 'No tiene permiso para esta operación.',
} = {}) => async (req, res, next) => {
    try {
        const contexto = await obtenerContextoRequest(db, req);
        req.user = { ...req.user, perfil_id: contexto.usuario.perfil_id };

        const cumpleTodos = allOf.every((clave) => tienePermisoFaregas(contexto.permisos, clave));
        const cumpleAlgun = anyOf.length === 0 || anyOf.some((clave) => tienePermisoFaregas(contexto.permisos, clave));
        if (!cumpleTodos || !cumpleAlgun) {
            return res.status(403).json({ success: false, message });
        }
        return next();
    } catch (error) {
        if (error?.status) {
            return res.status(error.status).json({ success: false, message: error.message });
        }
        return res.status(500).json({ success: false, message: 'No se pudo validar el permiso.' });
    }
};

module.exports = { crearMiddlewarePermisoFaregas };
