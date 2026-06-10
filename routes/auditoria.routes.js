const express = require('express');
const router = express.Router();
const auditoriaController = require('../controllers/auditoria.controller');

router.get('/accesos', auditoriaController.listarAuditoriaAcceso);

module.exports = router;