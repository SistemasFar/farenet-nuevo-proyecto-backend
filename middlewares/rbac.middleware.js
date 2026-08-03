const authService = require('../services/auth.service');

const requireAnyPermission = (permisosRequeridos) => {
    return async (req, res, next) => {
        try {
            if (!req.user || !req.user.username) {
                return res.status(401).json({ ok: false, message: 'Usuario no autenticado.' });
            }

            const userPerms = await authService.obtenerPermisosPorUsuario(req.user.username);
            
            const tienePermiso = permisosRequeridos.some(p => userPerms.includes(p));
            
            if (!tienePermiso) {
                return res.status(403).json({ ok: false, message: 'No tiene los permisos necesarios para realizar esta acción.' });
            }

            return next();
        } catch (error) {
            return res.status(500).json({ ok: false, message: 'Error validando permisos.' });
        }
    };
};

module.exports = { requireAnyPermission };
