const express = require('express');
const { authFaregasMiddleware } = require('../middlewares/faregas-auth.middleware');
const controller = require('../controllers/faregas-duplicados.controller');

const router = express.Router();
router.use(authFaregasMiddleware);

router.get('/tipos', controller.listarTipos);
router.get('/buscar', controller.buscar);
router.get('/historial', controller.listarHistorial);
router.post('/', controller.crear);
router.get('/:id', controller.obtener);
router.post('/:id/procesar', controller.procesar);
router.get('/:id/vista', controller.verVista);
router.get('/:id/pdf', controller.descargarPdf);
router.get('/:id/comprobante/pdf', controller.descargarComprobante);

module.exports = router;
