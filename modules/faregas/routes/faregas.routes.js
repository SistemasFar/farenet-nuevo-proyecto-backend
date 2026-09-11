const express = require('express');
const router = express.Router();
const healthController = require('../controllers/health.controller');
const auditoriaOperativaMiddleware = require('../middlewares/faregas-auditoria-operativa.middleware');

const usuariosRoutes = require('./faregas-usuarios.routes');

// Registra cambios administrativos despuÃ©s de que cada submÃ³dulo autentica al usuario.
router.use(auditoriaOperativaMiddleware);

// Endpoint inicial de comprobaciÃ³n
router.get('/ping', healthController.ping);

// MÃ³dulo de usuarios y perfiles
router.use('/usuarios', usuariosRoutes);

// MÃ³dulo de auditorÃ­a
const auditoriaRoutes = require('./faregas-auditoria.routes');
router.use('/auditoria', auditoriaRoutes);

// MÃ³dulo de certificados (Fase 1)
const certificadosRoutes = require('./faregas-certificados.routes');
router.use('/certificados', certificadosRoutes);

// MÃ³dulo de clientes y autocompletado vehicular (Fase 2)
const clientesRoutes = require('./faregas-clientes.routes');
router.use('/clientes', clientesRoutes);

const tarifasRoutes = require('./faregas-tarifas.routes');
router.use('/tarifas', tarifasRoutes);

const configRoutes = require('./faregas-config.routes');
router.use('/config', configRoutes);

const descuentosRoutes = require('./faregas-descuentos.routes');
router.use('/descuentos', descuentosRoutes);

const chipsRoutes = require('./faregas-chips.routes');
router.use('/chips', chipsRoutes);


// MÃ³dulo de operaciones comerciales sin certificado
const operacionesRoutes = require('./faregas-operaciones.routes');
const formatosRoutes = require('./faregas-formatos.routes');
router.use('/operaciones', operacionesRoutes);
router.use('/formatos', formatosRoutes);

module.exports = router;

