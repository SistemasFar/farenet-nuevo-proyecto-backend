const express = require('express');
const { authFaregasMiddleware } = require('../middlewares/faregas-auth.middleware');
const pagosController = require('../controllers/faregas-pagos.controller');
const facturacionController = require('../controllers/faregas-facturacion.controller');

const router = express.Router();
router.use(authFaregasMiddleware);

router.get('/:operacionId/pagos', pagosController.obtenerPorOperacion);
router.put('/:operacionId/pagos', pagosController.guardarPorOperacion);


router.get('/:operacionId/facturacion', facturacionController.obtenerPorOperacion);
router.put('/:operacionId/facturacion', facturacionController.guardarPorOperacion);
router.post('/:operacionId/facturacion/emitir', facturacionController.emitirPorOperacion);
router.post('/:operacionId/facturacion/reintentar', facturacionController.reintentarPorOperacion);

module.exports = router;
