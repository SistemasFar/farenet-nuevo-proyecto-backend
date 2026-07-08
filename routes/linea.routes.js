const express = require('express');
const router = express.Router();
const lineaController = require('../controllers/linea.controller');

router.get('/:nroInspeccion', lineaController.getInspeccion);
router.post('/:nroInspeccion/paso', lineaController.savePaso);
router.post('/:nroInspeccion/consolidar', lineaController.consolidar);
router.post('/:nroInspeccion/soporte/:accion', lineaController.soporteAction);

module.exports = router;
