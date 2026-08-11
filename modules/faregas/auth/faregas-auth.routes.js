const express = require('express');
const router = express.Router();
const faregasAuthController = require('./faregas-auth.controller');

router.post('/validar', faregasAuthController.validar);

module.exports = router;
