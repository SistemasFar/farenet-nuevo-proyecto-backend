const express = require('express');
const router = express.Router();
const maestrosController = require('../controllers/maestros.controller');

router.get('/caja', maestrosController.obtenerMaestrosCaja);

module.exports = router;
