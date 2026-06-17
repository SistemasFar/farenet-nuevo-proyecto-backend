const express = require('express');
const router = express.Router();

const inspeccionesController = require('../controllers/inspecciones.controller');

router.get('/buscar', inspeccionesController.buscarInspecciones);
router.post('/guardar', inspeccionesController.guardarInspeccion);

module.exports = router;