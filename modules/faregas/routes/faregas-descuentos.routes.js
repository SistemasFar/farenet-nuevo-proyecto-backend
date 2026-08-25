const express = require('express');
const router = express.Router();
const controller = require('../controllers/faregas-descuentos.controller');
const authMiddleware = require('../middlewares/faregas-auth.middleware');

router.use(authMiddleware.authFaregasMiddleware); // Aplicar auth a todas las rutas de descuentos

// Operativo - Nuevo Certificado
router.post('/consultar', controller.consultarDescuento);
router.get('/borradores/:certificadoId', controller.obtenerDescuentoBorrador);
router.put('/borradores/:certificadoId/aplicar', controller.aplicarDescuentoBorrador);
router.delete('/borradores/:certificadoId/aplicar', controller.quitarDescuentoBorrador);

// TODO: Rutas administrativas
// router.get('/', authMiddleware.validarPermiso('MENU_DESCUENTOS'), controller.listarDescuentos);
// ...

module.exports = router;
