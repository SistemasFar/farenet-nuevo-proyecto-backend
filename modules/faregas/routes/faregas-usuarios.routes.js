const express = require('express');
const router = express.Router();
const controller = require('../controllers/faregas-usuarios.controller');
const jwt = require('jsonwebtoken');
const db = require('../../../config/database');

const JWT_SECRET_FAREGAS = process.env.JWT_SECRET_FAREGAS;

const adminMiddleware = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ message: 'Token requerido' });
    }

    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, JWT_SECRET_FAREGAS);
        
        if (decoded.faregas_flow !== 'authenticated') {
            return res.status(403).json({ message: 'Flujo invalido' });
        }

        // Validacion estricta contra base de datos
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

        // Verificar permiso MENU_USUARIOS
        const permisoDb = await db.query(
            `SELECT 1 FROM fg_perfil_permiso 
             WHERE perfil_clave = $1 AND permiso_clave = 'MENU_USUARIOS'`,
            [user.perfil_id]
        );

        if (permisoDb.rowCount === 0) {
            return res.status(403).json({ message: 'No tiene permiso para administrar usuarios (MENU_USUARIOS)' });
        }

        req.user = decoded;
        next();
    } catch (e) {
        console.error('Error validando token FAREGAS en ADMIN', e);
        return res.status(401).json({ message: 'Token invalido o expirado' });
    }
};

router.use(adminMiddleware);

router.get('/', controller.obtenerUsuarios);
router.post('/', controller.crearUsuario);
router.put('/:username', controller.actualizarUsuario);
router.patch('/:username/password', controller.cambiarPassword);
router.delete('/:username', controller.eliminarUsuario);

router.get('/permisos', controller.obtenerPermisos);

router.get('/perfiles', controller.obtenerPerfiles);
router.post('/perfiles', controller.crearPerfil);
router.put('/perfiles/:clave', controller.actualizarPerfil);
router.delete('/perfiles/:clave', controller.eliminarPerfil);

router.get('/plantas', controller.obtenerPlantas);

// MAESTROS
router.get('/maestros/persona', controller.getMaestrosPersona);
router.get('/maestros/departamentos/:paisKey', controller.getDepartamentos);
router.get('/maestros/provincias/:departamentoKey', controller.getProvincias);
router.get('/maestros/distritos/:provinciaKey', controller.getDistritos);

module.exports = router;
