const express = require('express');
const router = express.Router();
const campanaController = require('../controllers/campana.controller');

router.post('/validar', campanaController.obtenerDescuentosYReinspeccion);
router.post('/consumir', campanaController.consumirDescuento);

module.exports = router;
