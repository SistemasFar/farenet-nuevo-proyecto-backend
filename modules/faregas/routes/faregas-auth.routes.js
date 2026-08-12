const express = require('express');
const router = express.Router();
const faregasAuthController = require('../controllers/faregas-auth.controller');

router.post('/validar', faregasAuthController.validar);
router.post('/login', faregasAuthController.login);
router.post('/confirmar-planta', faregasAuthController.confirmarPlanta);
module.exports = router;
