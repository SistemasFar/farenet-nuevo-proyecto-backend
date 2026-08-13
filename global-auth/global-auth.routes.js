const express = require('express');
const router = express.Router();
const globalAuthController = require('./global-auth.controller');

router.post('/detectar-empresas', globalAuthController.detectarEmpresas);

module.exports = router;
