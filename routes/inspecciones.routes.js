const express = require('express');
const router = express.Router();

const inspeccionesController = require('../controllers/inspecciones.controller');

router.get('/buscar', inspeccionesController.buscarInspecciones);
router.post('/guardar', inspeccionesController.guardarInspeccion);
router.post('/borrador', inspeccionesController.guardarBorrador);
router.get('/borrador/:id', inspeccionesController.obtenerBorrador);
router.delete('/borrador/:id', inspeccionesController.eliminarBorrador);
router.post('/consultar', inspeccionesController.consultarVehiculoYCaja);
router.get('/vehiculo-rapido/:placa', inspeccionesController.consultarVehiculoRapido);
router.get('/descuentos', inspeccionesController.buscarDescuentos);
router.post('/descuentos/consumir', inspeccionesController.consumirDescuento);
router.get('/reinspeccion/:placa/:concepto/:planta', inspeccionesController.consultarReinspeccion);

module.exports = router;