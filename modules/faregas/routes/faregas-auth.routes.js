const express = require('express');
const router = express.Router();
const faregasAuthController = require('../controllers/faregas-auth.controller');
const { authFaregasMiddleware } = require('../middlewares/faregas-auth.middleware');

router.post('/validar', faregasAuthController.validar);
router.post('/login', faregasAuthController.login);
router.post('/confirmar-planta', faregasAuthController.confirmarPlanta);
router.post('/cambiar-planta', faregasAuthController.cambiarPlanta);
router.post('/sesion/refrescar', authFaregasMiddleware, faregasAuthController.refrescarSesion);
module.exports = router;
