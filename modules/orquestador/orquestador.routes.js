const express = require('express');
const router = express.Router();
const orquestadorController = require('./orquestador.controller');

router.post('/detectar-empresas', orquestadorController.detectarEmpresas);

module.exports = router;
