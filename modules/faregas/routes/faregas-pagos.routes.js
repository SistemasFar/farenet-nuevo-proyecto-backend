const express = require('express');
const { authFaregasMiddleware } = require('../middlewares/faregas-auth.middleware');
const pagosController = require('../controllers/faregas-pagos.controller');

const router = express.Router();
router.use(authFaregasMiddleware);

// Catálogo aislado: nunca expone las cuentas legacy de FARENET.
router.get('/maestros', pagosController.obtenerMaestros);

module.exports = router;
