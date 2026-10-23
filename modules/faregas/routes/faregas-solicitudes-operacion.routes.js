const express = require('express');
const controller = require('../controllers/faregas-solicitudes-operacion.controller');
const { authFaregasMiddleware } = require('../middlewares/faregas-auth.middleware');

const router = express.Router();

router.use(authFaregasMiddleware);
router.use((req, res, next) => {
    if (req.user?.faregas_flow !== 'authenticated' || !req.user?.planta_key) {
        return res.status(403).json({
            ok: false,
            codigo: 'FAREGAS_SEDE_REQUERIDA',
            message: 'Seleccione una sede antes de utilizar el módulo de solicitudes.'
        });
    }
    return next();
});

router.get('/certificados/:certificadoId/contexto', controller.contextoCertificado);
router.post('/', controller.crear);
router.get('/', controller.listar);
router.get('/:id', controller.obtener);
router.post('/:id/aprobar', controller.aprobar);
router.post('/:id/rechazar', controller.rechazar);
router.post('/:id/cancelar', controller.cancelar);
router.post('/:id/ejecutar-anulacion-total', controller.ejecutarAnulacionTotal);
router.post('/:id/ejecutar', controller.ejecutarAnulacionTotal);
router.get('/:id/eventos', controller.historial);

module.exports = router;
