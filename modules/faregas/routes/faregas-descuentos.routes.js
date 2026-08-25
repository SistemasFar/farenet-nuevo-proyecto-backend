const express = require('express');
const router = express.Router();
const controller = require('../controllers/faregas-descuentos.controller');
const authMiddleware = require('../middlewares/faregas-auth.middleware');
const db = require('../../../config/database');

router.use(authMiddleware.authFaregasMiddleware); // Aplicar auth a todas las rutas de descuentos

const requireAdministrar = async (req, res, next) => {
    try {
        const permiso = await db.query(`SELECT 1 FROM fg_perfil_permiso
            WHERE perfil_clave=$1 AND permiso_clave='DESCUENTOS_ADMINISTRAR'`, [req.user.perfil_id]);
        if (!permiso.rowCount) return res.status(403).json({ success: false, message: 'No tiene permisos para administrar descuentos.' });
        next();
    } catch (_error) {
        res.status(500).json({ success: false, message: 'Error al verificar permisos de descuentos.' });
    }
};

// Operativo - Nuevo Certificado
router.post('/consultar', controller.consultarDescuento);
router.get('/borradores/:certificadoId', controller.obtenerDescuentoBorrador);
router.put('/borradores/:certificadoId/aplicar', controller.aplicarDescuentoBorrador);
router.delete('/borradores/:certificadoId/aplicar', controller.quitarDescuentoBorrador);

router.get('/maestros', requireAdministrar, controller.obtenerMaestros);
router.get('/', requireAdministrar, controller.listarDescuentos);
router.post('/', requireAdministrar, controller.crearDescuento);
router.get('/:id', requireAdministrar, controller.obtenerDetalle);
router.put('/:id', requireAdministrar, controller.actualizarDescuento);
router.patch('/:id/estado', requireAdministrar, controller.cambiarEstadoDescuento);
router.post('/:id/codigos', requireAdministrar, controller.crearCodigo);
router.patch('/codigos/:id/estado', requireAdministrar, controller.cambiarEstadoCodigo);

module.exports = router;
