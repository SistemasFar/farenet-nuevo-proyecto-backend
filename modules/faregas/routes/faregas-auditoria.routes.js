const express = require('express');
const router = express.Router();
const controller = require('../controllers/faregas-auditoria.controller');
const jwt = require('jsonwebtoken');
const db = require('../../../config/database');

const JWT_SECRET_FAREGAS = process.env.JWT_SECRET_FAREGAS || 'fallback_faregas_secret';

const auditoriaMiddleware = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ message: 'Token requerido' });
    }

    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, JWT_SECRET_FAREGAS);
        
        if (decoded.faregas_flow !== 'authenticated') {
            return res.status(403).json({ message: 'Flujo inválido' });
        }

        const userDb = await db.query(
            'SELECT estado, perfil_id FROM fg_usuario WHERE username = $1 LIMIT 1', 
            [decoded.username]
        );

        if (userDb.rowCount === 0) {
            return res.status(401).json({ message: 'Usuario no existe' });
        }

        const user = userDb.rows[0];
        if (!user.estado) {
            return res.status(403).json({ message: 'Usuario inactivo' });
        }

        // Verificar permiso MENU_AUDITORIA contra BD
        const permisoDb = await db.query(
            `SELECT 1 FROM fg_perfil_permiso pp
             JOIN fg_permiso p ON pp.permiso_clave = p.clave
             WHERE pp.perfil_clave = $1 AND p.clave = 'MENU_AUDITORIA' AND p.activo = true`,
            [user.perfil_id]
        );

        if (permisoDb.rowCount === 0) {
            return res.status(403).json({ message: 'No tiene permiso para ver la auditoría (MENU_AUDITORIA)' });
        }

        req.user = { ...decoded, perfil_id: user.perfil_id };
        next();
    } catch (e) {
        console.error("Error validando token FAREGAS en AUDITORIA", e);
        return res.status(401).json({ message: 'Token inválido o expirado' });
    }
};

router.use(auditoriaMiddleware);

router.get('/accesos', controller.listarAccesos);

module.exports = router;
