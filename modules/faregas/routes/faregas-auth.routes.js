const express = require('express');
const router = express.Router();
router.use(require('../middlewares/faregas-referencia-error.middleware'));
const faregasAuthController = require('../controllers/faregas-auth.controller');
const { authFaregasMiddleware } = require('../middlewares/faregas-auth.middleware');

router.post('/validar', faregasAuthController.validar);
router.post('/login', faregasAuthController.login);
router.post('/confirmar-planta', faregasAuthController.confirmarPlanta);
router.post('/cambiar-planta', faregasAuthController.cambiarPlanta);
router.post('/sesion/refrescar', authFaregasMiddleware, faregasAuthController.refrescarSesion);
router.post('/cambiar-contrasena', authFaregasMiddleware, faregasAuthController.cambiarContrasena);
module.exports = router;
