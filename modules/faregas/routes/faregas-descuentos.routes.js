const express = require('express');
const router = express.Router();
const controller = require('../controllers/faregas-descuentos.controller');
const authMiddleware = require('../middlewares/faregas-auth.middleware');
const db = require('../../../config/database');
const { crearMiddlewarePermisoFaregas } = require('../middlewares/faregas-permisos.middleware');

router.use(authMiddleware.authFaregasMiddleware); // Aplicar auth a todas las rutas de descuentos

const requireAdministrar = crearMiddlewarePermisoFaregas(db, {
    anyOf: ['DESCUENTOS_ADMINISTRAR'],
    message: 'No tiene permisos para administrar descuentos.'
});

// Operativo - Nuevo Certificado
router.post('/consultar', controller.consultarDescuento);
router.get('/borradores/:certificadoId/disponibles', controller.listarDescuentosDisponibles);
router.get('/borradores/:certificadoId', controller.obtenerDescuentoBorrador);
router.put('/borradores/:certificadoId/aplicar', controller.aplicarDescuentoBorrador);
router.delete('/borradores/:certificadoId/aplicar', controller.quitarDescuentoBorrador);

router.get('/maestros', requireAdministrar, controller.obtenerMaestros);
router.get('/', requireAdministrar, controller.listarDescuentos);
router.post('/', requireAdministrar, controller.crearDescuento);
router.get('/:id', requireAdministrar, controller.obtenerDetalle);
router.put('/:id', requireAdministrar, controller.actualizarDescuento);
router.patch('/:id/estado', requireAdministrar, controller.cambiarEstadoDescuento);
router.get('/:id/impacto', requireAdministrar, controller.impactoDescuento);
router.delete('/:id', requireAdministrar, controller.eliminarDescuento);
router.put('/:id/reglas', requireAdministrar, controller.guardarReglasDescuento);
router.get('/:id/codigos', requireAdministrar, controller.listarCodigos);
router.post('/:id/codigos/lote', requireAdministrar, controller.generarLoteCodigos);
router.post('/:id/codigos/importar', requireAdministrar, controller.importarCodigos);
router.post('/:id/codigos', requireAdministrar, controller.crearCodigo);
router.put('/codigos/:id', requireAdministrar, controller.actualizarCodigo);
router.patch('/codigos/:id/estado', requireAdministrar, controller.cambiarEstadoCodigo);

module.exports = router;
