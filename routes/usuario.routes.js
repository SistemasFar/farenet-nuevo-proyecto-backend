const express = require('express');
const router = express.Router();
const usuarioController = require('../controllers/usuario.controller');

router.get('/GetPlantasByUsuario/:username', usuarioController.getPlantasByUsuario);

module.exports = router;
