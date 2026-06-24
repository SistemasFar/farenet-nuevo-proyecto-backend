const express = require('express');
const router = express.Router();
const vehiculoController = require('../controllers/vehiculo.controller');

router.get('/buscar/:placa', vehiculoController.buscarPorPlaca);

module.exports = router;
