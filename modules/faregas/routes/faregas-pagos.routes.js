const express = require('express');
const { authFaregasMiddleware } = require('../middlewares/faregas-auth.middleware');
const { crearMiddlewarePermisoFaregas } = require('../middlewares/faregas-permisos.middleware');
const db = require('../../../config/database');
const pagosController = require('../controllers/faregas-pagos.controller');

const router = express.Router();
router.use(authFaregasMiddleware);
const permisoOperacionesPago = crearMiddlewarePermisoFaregas(db, {
    anyOf: ['MENU_INICIO', 'MENU_CHIPS_VENTAS'],
    message: 'No tiene permiso para consultar los medios de pago de una operación.'
});

// Catálogo aislado: nunca expone las cuentas legacy de FARENET.
router.get('/maestros', permisoOperacionesPago, pagosController.obtenerMaestros);

module.exports = router;
