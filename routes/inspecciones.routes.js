const express = require('express');
const router = express.Router();

const inspeccionesController = require('../controllers/inspecciones.controller');

router.get('/buscar', inspeccionesController.buscarInspecciones);
router.post('/guardar', inspeccionesController.guardarInspeccion);
router.get('/generar-nro/:plantaKey', inspeccionesController.generarNroInspeccion);
router.post('/guardar/proceso', inspeccionesController.guardarProceso);
router.get('/proceso/:nrodocumentoinspeccion', inspeccionesController.obtenerProceso);
router.post('/anular/guardar', inspeccionesController.anularInspeccion);
router.post('/consultar', inspeccionesController.consultarVehiculoYCaja);
router.get('/vehiculo-rapido/:placa', inspeccionesController.consultarVehiculoRapido);
router.get('/descuentos', inspeccionesController.buscarDescuentos);
router.post('/descuentos/consumir', inspeccionesController.consumirDescuento);
router.get('/reinspeccion/:placa/:concepto/:planta', inspeccionesController.consultarReinspeccion);
router.get('/reinspecciones-activas/:placa', inspeccionesController.consultarReinspeccionesActivas);
router.get('/cuponidad/validar/:codigo', inspeccionesController.validarCuponidad);
router.post('/:nrodocumentoinspeccion/anular', inspeccionesController.anularInspeccionCompleta);
router.post('/:nrodocumentoinspeccion/error-impresion', inspeccionesController.errorImpresion);
router.post('/:nro/traspaso-resultados', inspeccionesController.traspasarResultados);

module.exports = router;