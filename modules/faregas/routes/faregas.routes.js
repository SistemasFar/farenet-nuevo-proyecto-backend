const express = require('express');
const router = express.Router();
const healthController = require('../controllers/health.controller');

// Endpoint inicial de comprobación
router.get('/ping', healthController.ping);

module.exports = router;
