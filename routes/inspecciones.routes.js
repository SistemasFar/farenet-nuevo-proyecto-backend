const express = require('express');
const router = express.Router();

const inspeccionesController = require('../controllers/inspecciones.controller');

router.get('/buscar', inspeccionesController.buscarInspecciones);

module.exports = router;