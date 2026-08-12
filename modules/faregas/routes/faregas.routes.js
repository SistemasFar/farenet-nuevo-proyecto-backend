const express = require('express');
const router = express.Router();
const healthController = require('../controllers/health.controller');

const usuariosRoutes = require('./faregas-usuarios.routes');

// Endpoint inicial de comprobación
router.get('/ping', healthController.ping);

// Módulo de usuarios y perfiles
router.use('/usuarios', usuariosRoutes);

// Módulo de auditoría
const auditoriaRoutes = require('./faregas-auditoria.routes');
router.use('/auditoria', auditoriaRoutes);

module.exports = router;
