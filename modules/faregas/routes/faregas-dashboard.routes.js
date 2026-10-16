const express = require('express');
const router = express.Router();
const { authFaregasMiddleware } = require('../middlewares/faregas-auth.middleware');
const controller = require('../controllers/faregas-dashboard.controller');
const db = require('../../../config/database');

const verificarAccesoDashboard = async (req, res, next) => {
    try {
        const perfilId = req.user?.perfil_id;
        if (perfilId === 'SISTEMAS') return next();

        const r = await db.query(
            `SELECT 1 FROM fg_perfil_permiso 
             WHERE perfil_clave = $1 
               AND permiso_clave IN ('MENU_DASHBOARD', 'DASHBOARD_GLOBAL', 'DASHBOARD_SEDE') 
             LIMIT 1`,
            [perfilId]
        );

        if (r.rowCount === 0) {
            return res.status(403).json({
                success: false,
                message: 'No tiene permiso para acceder al módulo Dashboard.'
            });
        }
        next();
    } catch (e) {
        console.error('Error al verificar permiso dashboard:', e);
        return res.status(500).json({ success: false, message: 'Error interno al validar permisos.' });
    }
};

const { middlewareValidarRangoFechasDashboard } = require('../services/faregas-dashboard-fechas.service');

router.use(authFaregasMiddleware);
router.use(verificarAccesoDashboard);
router.use(middlewareValidarRangoFechasDashboard);

router.get('/resumen', controller.obtenerResumen);
router.get('/sedes', controller.obtenerSedes);
router.get('/detalle/certificados', controller.obtenerCertificados);
router.get('/detalle/productos', controller.obtenerProductos);
router.get('/detalle/comprobantes', controller.obtenerComprobantes);
router.get('/detalle/pagos', controller.obtenerPagos);
router.get('/detalle/descuentos', controller.obtenerDescuentos);
router.get('/detalle/usuarios', controller.obtenerUsuarios);
router.get('/exportacion', controller.obtenerExportacion);

module.exports = router;
