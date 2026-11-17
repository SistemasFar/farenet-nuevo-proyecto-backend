const express = require('express');
const router = express.Router();
const { authFaregasMiddleware } = require('../middlewares/faregas-auth.middleware');
const controller = require('../controllers/faregas-dashboard.controller');

const verificarAccesoDashboard = async (req, res, next) => {
    try {
        if (req.user?.faregas_flow !== 'authenticated' || !req.user?.planta_key) {
            return res.status(403).json({
                success: false,
                message: 'Seleccione una sede antes de consultar el Dashboard.'
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
router.get('/detalle/duplicados', controller.obtenerDuplicados);
router.get('/detalle/productos', controller.obtenerProductos);
router.get('/detalle/comprobantes', controller.obtenerComprobantes);
router.get('/detalle/pagos', controller.obtenerPagos);
router.get('/detalle/descuentos', controller.obtenerDescuentos);
router.get('/detalle/usuarios', controller.obtenerUsuarios);
router.get('/exportacion', controller.obtenerExportacion);
router.get('/exportacion-financiera', controller.obtenerReporteFinanciero);
router.get('/documentos-emitidos-extendido', controller.obtenerDocumentosEmitidosExtendido);
router.get('/resumen-mensual-facturacion', controller.obtenerResumenMensualFacturacion);
router.get('/registro-ventas-tributario', controller.obtenerRegistroVentasTributario);

module.exports = router;
