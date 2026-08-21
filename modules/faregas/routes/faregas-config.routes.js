const express = require('express');
const router = express.Router();
const configController = require('../controllers/faregas-config.controller');
const { authFaregasMiddleware } = require('../middlewares/faregas-auth.middleware');
const db = require('../../../config/database');

const requireConfigSedesPerm = async (req, res, next) => {
    try {
        const permisoDb = await db.query(
            `SELECT 1 FROM fg_perfil_permiso 
             WHERE perfil_clave = $1 AND permiso_clave IN ('MENU_CONFIGURACION', 'CONFIGURACION_SEDES')
             GROUP BY perfil_clave
             HAVING COUNT(*) = 2`,
            [req.user.perfil_id]
        );

        if (permisoDb.rowCount === 0) {
            return res.status(403).json({ success: false, message: 'No tiene permisos para administrar sedes.' });
        }
        next();
    } catch (e) {
        res.status(500).json({ success: false, message: 'Error al verificar permisos' });
    }
};

const requireConfigServiciosPerm = async (req, res, next) => {
    try {
        const permisoDb = await db.query(
            `SELECT 1 FROM fg_perfil_permiso 
             WHERE perfil_clave = $1 AND permiso_clave IN ('MENU_CONFIGURACION', 'CONFIGURACION_SERVICIOS')
             GROUP BY perfil_clave
             HAVING COUNT(*) = 2`,
            [req.user.perfil_id]
        );

        if (permisoDb.rowCount === 0) {
            return res.status(403).json({ success: false, message: 'No tiene permisos para administrar servicios.' });
        }
        next();
    } catch (e) {
        res.status(500).json({ success: false, message: 'Error al verificar permisos' });
    }
};

router.use(authFaregasMiddleware);

router.get('/sedes', requireConfigSedesPerm, configController.getSedes);
router.post('/sedes', requireConfigSedesPerm, configController.crearSede);
router.put('/sedes/:key', requireConfigSedesPerm, configController.editarSede);
router.put('/sedes/:key/estado', requireConfigSedesPerm, configController.cambiarEstadoSede);

router.get('/servicios', requireConfigServiciosPerm, configController.getServicios);
router.post('/servicios', requireConfigServiciosPerm, configController.crearServicio);
router.put('/servicios/:id', requireConfigServiciosPerm, configController.editarServicio);
router.put('/servicios/:id/estado', requireConfigServiciosPerm, configController.cambiarEstadoServicio);

module.exports = router;
