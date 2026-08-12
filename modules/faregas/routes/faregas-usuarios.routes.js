const express = require('express');
const router = express.Router();
const controller = require('../controllers/faregas-usuarios.controller');
const jwt = require('jsonwebtoken');
const db = require('../../../config/database');

const JWT_SECRET_FAREGAS = process.env.JWT_SECRET_FAREGAS || 'fallback_faregas_secret';

const adminMiddleware = async (req, res, next) => {
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

        // Validación estricta contra base de datos
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

        if (user.perfil_id !== 'SISTEMAS') {
            return res.status(403).json({ message: 'No tiene permisos de administrador (SISTEMAS)' });
        }

        req.user = decoded;
        next();
    } catch (e) {
        console.error("Error validando token FAREGAS en ADMIN", e);
        return res.status(401).json({ message: 'Token inválido o expirado' });
    }
};

router.use(adminMiddleware);

router.get('/', controller.obtenerUsuarios);
router.post('/', controller.crearUsuario);
router.put('/:username', controller.actualizarUsuario);
router.patch('/:username/password', controller.cambiarPassword);

router.get('/perfiles', controller.obtenerPerfiles);
router.post('/perfiles', controller.crearPerfil);
router.put('/perfiles/:clave', controller.actualizarPerfil);
router.delete('/perfiles/:clave', controller.eliminarPerfil);

router.get('/plantas', controller.obtenerPlantas);

module.exports = router;
