const express = require('express');
const router = express.Router();
const configController = require('../controllers/faregas-config.controller');
const productosController = require('../controllers/faregas-productos.controller');
const tarifasAdminController = require('../controllers/faregas-tarifas-admin.controller');
const seriesController = require('../controllers/faregas-series.controller');
const nubefactReadinessController = require('../controllers/faregas-nubefact-readiness.controller');
const { authFaregasMiddleware } = require('../middlewares/faregas-auth.middleware');
const { createFaregasConfigPermissionGuards } = require('../middlewares/faregas-config-permissions.middleware');
const db = require('../../../config/database');
const {
    requireConfigSedesPerm,
    requireConfigServiciosPerm,
    requireConfigServiciosOProductosPerm,
    requireConfigCategoriasPerm,
    requireLecturaCategoriasPerm,
    requireConfigProductosPerm,
    requireConfigTarifasPerm,
    requireConfigSeriesPerm,
    requireConfigEmpresasPerm,
} = createFaregasConfigPermissionGuards(db);

router.use(authFaregasMiddleware);

router.get('/sedes', requireConfigSedesPerm, configController.getSedes);
router.post('/sedes', requireConfigSedesPerm, configController.crearSede);
router.put('/sedes/:key', requireConfigSedesPerm, configController.editarSede);
router.put('/sedes/:key/estado', requireConfigSedesPerm, configController.cambiarEstadoSede);

router.get('/empresas', requireConfigEmpresasPerm, configController.getEmpresas);
router.get('/empresas/sedes', requireConfigEmpresasPerm, configController.getSedesEmpresas);
router.post('/empresas', requireConfigEmpresasPerm, configController.crearEmpresa);
router.put('/empresas/:key', requireConfigEmpresasPerm, configController.editarEmpresa);
router.put('/empresas/:key/estado', requireConfigEmpresasPerm, configController.cambiarEstadoEmpresa);
router.put('/sedes/:key/empresa', requireConfigEmpresasPerm, configController.asignarEmpresaSede);

router.get('/servicios', requireConfigServiciosOProductosPerm, configController.getServicios);
router.get('/servicios/sedes', requireConfigServiciosOProductosPerm, configController.obtenerSedesPorServicio);
router.post('/servicios', requireConfigServiciosPerm, configController.crearServicio);
router.put('/servicios/:id', requireConfigServiciosPerm, configController.editarServicio);
router.put('/servicios/:id/estado', requireConfigServiciosPerm, configController.cambiarEstadoServicio);
router.put('/servicios/:id/formato', requireConfigServiciosPerm, configController.asignarFormato);
router.post('/servicios/:id/formato/variante', requireConfigServiciosPerm, configController.crearVarianteParaServicio);

router.get('/categorias', requireLecturaCategoriasPerm, configController.getCategorias);
router.post('/categorias', requireConfigCategoriasPerm, configController.crearCategoria);
router.put('/categorias/:id', requireConfigCategoriasPerm, configController.editarCategoria);
router.put('/categorias/:id/estado', requireConfigCategoriasPerm, configController.cambiarEstadoCategoria);
router.get('/categorias/:id/impacto', requireConfigCategoriasPerm, configController.obtenerImpactoCategoria);
router.delete('/categorias/:id', requireConfigCategoriasPerm, configController.eliminarCategoria);

router.get('/productos', requireConfigProductosPerm, productosController.listar);
// Antes que cualquier ruta con :id. Alimenta la pantalla "Operación y formatos",
// que necesita el producto fiscal de cada categoría operativa.
router.get('/productos/por-categoria', requireConfigProductosPerm, productosController.listarPorCategoria);
router.post('/productos', requireConfigProductosPerm, productosController.crear);
router.put('/productos/:id', requireConfigProductosPerm, productosController.editar);
router.put('/productos/:id/estado', requireConfigProductosPerm, productosController.cambiarEstado);
router.get('/productos/:id/impacto', requireConfigProductosPerm, productosController.obtenerImpacto);
router.delete('/productos/:id', requireConfigProductosPerm, productosController.eliminar);

router.get('/tarifas/sedes', requireConfigTarifasPerm, tarifasAdminController.listarSedes);
router.get('/tarifas/servicios-disponibles', requireConfigTarifasPerm, tarifasAdminController.listarServiciosDisponibles);
router.get('/tarifas/productos', requireConfigTarifasPerm, tarifasAdminController.buscarProductos);
router.get('/tarifas', requireConfigTarifasPerm, tarifasAdminController.listar);
router.get('/nubefact/readiness', requireConfigTarifasPerm, nubefactReadinessController.obtenerPanel);
router.post('/tarifas/importar/previsualizar', requireConfigTarifasPerm, nubefactReadinessController.previsualizarCatalogo);
router.post('/tarifas/importar/aplicar', requireConfigTarifasPerm, nubefactReadinessController.aplicarCatalogo);
router.post('/tarifas', requireConfigTarifasPerm, tarifasAdminController.crear);
router.put('/tarifas/:id', requireConfigTarifasPerm, tarifasAdminController.editar);
router.put('/tarifas/:id/estado', requireConfigTarifasPerm, tarifasAdminController.cambiarEstado);

router.get('/series/sedes', requireConfigSeriesPerm, seriesController.listarSedes);
// Maestro de series para la pantalla de Configuración: sede opcional y sin
// sustitución por `seriedocumentobase`. Reutiliza el permiso CONFIGURACION_SERIES.
router.get('/series/maestro', requireConfigSeriesPerm, seriesController.listarMaestro);
router.get('/series', requireConfigSeriesPerm, seriesController.listar);
router.post('/series', requireConfigSeriesPerm, seriesController.crear);
router.put('/series/:id', requireConfigSeriesPerm, seriesController.editar);
router.put('/series/:id/estado', requireConfigSeriesPerm, seriesController.cambiarEstado);
router.put('/series/:id/confirmacion-produccion', requireConfigSeriesPerm, seriesController.confirmarProduccion);

module.exports = router;
