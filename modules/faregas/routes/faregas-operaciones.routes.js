const express = require('express');
const { authFaregasMiddleware } = require('../middlewares/faregas-auth.middleware');
const pagosController = require('../controllers/faregas-pagos.controller');
const facturacionController = require('../controllers/faregas-facturacion.controller');
const db = require('../../../config/database');
const { crearMiddlewarePermisoFaregas } = require('../middlewares/faregas-permisos.middleware');

const router = express.Router();
router.use(authFaregasMiddleware);
router.use(crearMiddlewarePermisoFaregas(db, {
    anyOf: ['MENU_INICIO'],
    message: 'No tiene permiso para consultar o gestionar operaciones de certificados.'
}));

router.get('/:operacionId/pagos', pagosController.obtenerPorOperacion);
router.put('/:operacionId/pagos', pagosController.guardarPorOperacion);


router.get('/:operacionId/facturacion', facturacionController.obtenerPorOperacion);
router.put('/:operacionId/facturacion', facturacionController.guardarPorOperacion);
router.post('/:operacionId/facturacion/emitir', facturacionController.emitirPorOperacion);
router.post('/:operacionId/facturacion/reintentar', facturacionController.reintentarPorOperacion);

module.exports = router;
