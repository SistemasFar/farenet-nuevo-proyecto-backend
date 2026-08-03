const express = require('express');
const router = express.Router();

const inspeccionesController = require('../controllers/inspecciones.controller');
const {
    validarAccesoPlantaInspeccion,
    validarPlantaEnBody,
    validarPlantaEnParams,
    validarPlantaPorInspeccionBody,
    validarPlantaEnQuery
} = require('../middlewares/planta.auth.middleware');
const { requireAnyPermission } = require('../middlewares/rbac.middleware');

router.get('/buscar', validarPlantaEnQuery, inspeccionesController.buscarInspecciones); // Global param o activa
router.post('/guardar', validarPlantaEnBody, inspeccionesController.guardarInspeccion);
router.post('/guardar-duplicado', validarPlantaEnBody, inspeccionesController.guardarDuplicado);
router.get('/buscar-info-duplicado/:placa', inspeccionesController.buscarInfoDuplicado); // Global
router.get('/generar-nro/:plantaKey', validarPlantaEnParams, inspeccionesController.generarNroInspeccion);
router.post('/guardar/proceso', validarPlantaEnBody, inspeccionesController.guardarProceso);
router.get('/proceso/:nrodocumentoinspeccion', inspeccionesController.obtenerProceso);
router.post('/anular/guardar', inspeccionesController.anularInspeccion);
router.post('/consultar', inspeccionesController.consultarVehiculoYCaja); // Body pero global
router.get('/vehiculo-rapido/:placa', inspeccionesController.consultarVehiculoRapido); // N/A
router.get('/descuentos', inspeccionesController.buscarDescuentos); // Global
router.post('/descuentos/consumir', inspeccionesController.consumirDescuento);
router.get('/reinspeccion/:placa/:concepto/:planta', validarPlantaEnParams, inspeccionesController.consultarReinspeccion);
router.get('/reinspecciones-activas/:placa', inspeccionesController.consultarReinspeccionesActivas); // Global
router.get('/cuponidad/validar/:codigo', inspeccionesController.validarCuponidad); // N/A
router.post('/:nrodocumentoinspeccion/anular', inspeccionesController.anularInspeccionCompleta);
router.post('/:nrodocumentoinspeccion/error-impresion', inspeccionesController.errorImpresion);
router.post('/:nro/traspaso-resultados', inspeccionesController.traspasarResultados);

module.exports = router;