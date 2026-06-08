const express = require('express');
const router = express.Router();
const usuarioController = require('../controllers/usuario.controller');

// Mapeamos los métodos aceptando variaciones de rutas para curarnos en salud contra errores del front
router.post('/GetUsuarioByUsername', usuarioController.getUsuarioByUsername);
router.get('/GetUsuarioByUsername', usuarioController.getUsuarioByUsername);

router.get('/GetPlantasByUsuario/:username', usuarioController.getPlantasByUsuario);

module.exports = router;