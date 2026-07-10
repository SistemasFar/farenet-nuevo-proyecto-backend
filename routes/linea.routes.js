const express = require('express');
const router = express.Router();
const lineaController = require('../controllers/linea.controller');

// RUTAS MÁS ESPECÍFICAS PRIMERO (para evitar que /:nroInspeccion capture todo)

// FASE 9.5 — Guardado transaccional de consolidación
router.post('/consolidacion/:nroInspeccion/guardar', lineaController.guardarConsolidacion);

// Rutas de lectura específicas (van antes del wildcard /:nroInspeccion)
router.post('/appresultado', lineaController.appresultado);
router.get('/pruebas-obligatorias/:nroInspeccion', lineaController.getPruebasObligatorias);
router.get('/estado/:nroInspeccion', lineaController.getEstado);
router.get('/consolidacion/:nroInspeccion', lineaController.getConsolidacionDatos);

// Rutas genéricas (van al final)
router.get('/:nroInspeccion', lineaController.getInspeccion);
router.post('/:nroInspeccion/paso', lineaController.savePaso);
router.post('/:nroInspeccion/consolidar', lineaController.consolidar);
router.post('/:nroInspeccion/soporte/:accion', lineaController.soporteAction);

module.exports = router;
