const express = require('express');
const router = express.Router();
const lineaController = require('../controllers/linea.controller');

router.get('/:nroInspeccion', lineaController.getInspeccion);
router.post('/:nroInspeccion/paso', lineaController.savePaso);

module.exports = router;
