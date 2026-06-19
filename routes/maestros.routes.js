const express = require('express');
const router = express.Router();
const maestrosController = require('../controllers/maestros.controller');

router.get('/caja', maestrosController.obtenerMaestrosCaja);
router.get('/precio', maestrosController.obtenerPrecioConcepto);
router.get('/pago', maestrosController.obtenerMaestrosPago);
router.get('/vehiculo', maestrosController.obtenerMaestrosVehiculo);
router.get('/vehiculo/modelos', maestrosController.buscarModelosVehiculo);
router.get('/vehiculo/colores', maestrosController.buscarColoresVehiculo);
router.post('/agregar', maestrosController.agregarNuevoMaestro);
router.get('/propietario', maestrosController.obtenerMaestrosPropietario);
router.get('/provincias/:departamento_key', maestrosController.obtenerProvincias);
router.get('/distritos/:provincia_key', maestrosController.obtenerDistritos);

module.exports = router;
