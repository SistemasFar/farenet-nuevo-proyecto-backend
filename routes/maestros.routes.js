const express = require('express');
const router = express.Router();
const maestrosController = require('../controllers/maestros.controller');

router.get('/caja', maestrosController.obtenerMaestrosCaja);
router.get('/precio', maestrosController.obtenerPrecioConcepto);
router.get('/pago', maestrosController.obtenerMaestrosPago);

module.exports = router;
