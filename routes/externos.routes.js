const express = require('express');
const router = express.Router();
const externosController = require('../controllers/externos.controller');

router.get('/dni/:numero', externosController.consultarDni);
router.get('/ruc/:numero', externosController.consultarRuc);

module.exports = router;
