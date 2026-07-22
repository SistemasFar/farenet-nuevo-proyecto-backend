const express = require('express');
const router = express.Router();
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });

const lineaController = require('../controllers/linea.controller');
const authMiddleware = require('../middlewares/auth.middleware');
const machineAuthMiddleware = require('../middlewares/machine.auth.middleware');
const validarAccesoPlantaInspeccion = require('../middlewares/planta.auth.middleware');

// RUTAS MÁS ESPECÍFICAS PRIMERO (para evitar que /:nroInspeccion capture todo)

// FASE 9.5 — Guardado transaccional de consolidación
router.get('/recibo/:nroInspeccion', authMiddleware, validarAccesoPlantaInspeccion, lineaController.obtenerRecibo);
router.post('/consolidacion/:nroInspeccion/guardar', authMiddleware, validarAccesoPlantaInspeccion, lineaController.guardarConsolidacion);

// TAREA 11 — Cambiar Observación
router.patch('/consolidacion/:nroInspeccion/observacion', authMiddleware, validarAccesoPlantaInspeccion, lineaController.cambiarObservacion);

// Acciones de Consolidación (Autoguardado y Modales de Soporte)
router.patch('/consolidacion/:nroInspeccion/datos', authMiddleware, validarAccesoPlantaInspeccion, lineaController.guardarDatosConsolidacion);
router.patch('/consolidacion/:nroInspeccion/poliza', authMiddleware, validarAccesoPlantaInspeccion, lineaController.registrarPoliza);
router.patch('/consolidacion/:nroInspeccion/linea', authMiddleware, validarAccesoPlantaInspeccion, lineaController.cambiarLinea);
router.patch('/consolidacion/:nroInspeccion/motor', authMiddleware, validarAccesoPlantaInspeccion, lineaController.cambiarMotor);
router.patch('/consolidacion/:nroInspeccion/firma', authMiddleware, validarAccesoPlantaInspeccion, lineaController.cambiarFirma);

// TAREA Anular Inspección
router.patch('/consolidacion/:nroInspeccion/anular', authMiddleware, validarAccesoPlantaInspeccion, lineaController.anularInspeccion);

// TAREA Reiniciar Prueba/Foto y Cambiar Foto
router.post('/foto/:nroInspeccion/cambiar', authMiddleware, validarAccesoPlantaInspeccion, upload.single('file'), lineaController.cambiarFoto);
router.post('/foto/:nroInspeccion/reiniciar', authMiddleware, validarAccesoPlantaInspeccion, lineaController.reiniciarFoto);
router.post('/prueba/:nroInspeccion/reiniciar', authMiddleware, validarAccesoPlantaInspeccion, lineaController.reiniciarPrueba);

router.get('/previsualizacion/:nroInspeccion', authMiddleware, validarAccesoPlantaInspeccion, lineaController.obtenerPreVisualizacion);
router.get('/informe-visualizacion/:nroInspeccion', authMiddleware, validarAccesoPlantaInspeccion, lineaController.generarHtmlInformeVisualizacion);
router.get('/certificado-oficial/:nroInspeccion', authMiddleware, validarAccesoPlantaInspeccion, lineaController.generarHtmlCertificadoOficial);

// Rutas de lectura específicas (van antes del wildcard /:nroInspeccion)
router.post('/appresultado', machineAuthMiddleware, lineaController.appresultado);
router.get('/pruebas-obligatorias/:nroInspeccion', authMiddleware, validarAccesoPlantaInspeccion, lineaController.getPruebasObligatorias);
router.get('/estado/:nroInspeccion', authMiddleware, validarAccesoPlantaInspeccion, lineaController.getEstado);
router.get('/consolidacion/:nroInspeccion', authMiddleware, validarAccesoPlantaInspeccion, lineaController.getConsolidacionDatos);
router.get('/wizard/:nroInspeccion', authMiddleware, validarAccesoPlantaInspeccion, lineaController.getWizardModel);
router.get('/propietario/:nroInspeccion', authMiddleware, validarAccesoPlantaInspeccion, lineaController.getPropietario);
router.patch('/propietario/:nroInspeccion', authMiddleware, validarAccesoPlantaInspeccion, lineaController.modificarPropietario);
// Rutas genéricas (van al final)
router.get('/:nroInspeccion', authMiddleware, validarAccesoPlantaInspeccion, lineaController.getInspeccion);
router.post('/:nroInspeccion/paso', lineaController.savePaso);
router.post('/:nroInspeccion/consolidar', lineaController.consolidar);
router.post('/:nroInspeccion/soporte/:accion', lineaController.soporteAction);

module.exports = router;
