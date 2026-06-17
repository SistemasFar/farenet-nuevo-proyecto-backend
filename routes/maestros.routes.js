const express = require('express');
const router = express.Router();
const maestrosController = require('../controllers/maestros.controller');

router.get('/caja', maestrosController.obtenerMaestrosCaja);
router.get('/precio', maestrosController.obtenerPrecioConcepto);
router.get('/pago', maestrosController.obtenerMaestrosPago);
router.get('/vehiculo', maestrosController.obtenerMaestrosVehiculo);
router.get('/vehiculo/modelos', maestrosController.buscarModelosVehiculo);

module.exports = router;
