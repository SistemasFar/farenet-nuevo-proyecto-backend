const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');

// Dejamos las rutas limpias y alineadas al prefijo del enrutador
router.post('/login', authController.login);
router.post('/logout', authController.logout);

// 🚀 RUTA CORREGIDA: Quitamos el '/auth' duplicado para que calce con tu api.tsx
router.post('/confirmar-planta', authController.confirmarPlanta); 

module.exports = router;