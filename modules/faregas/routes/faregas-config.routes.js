const express = require('express');
const router = express.Router();
const configController = require('../controllers/faregas-config.controller');
const productosController = require('../controllers/faregas-productos.controller');
const tarifasAdminController = require('../controllers/faregas-tarifas-admin.controller');
const seriesController = require('../controllers/faregas-series.controller');
const nubefactReadinessController = require('../controllers/faregas-nubefact-readiness.controller');
const { authFaregasMiddleware } = require('../middlewares/faregas-auth.middleware');
const db = require('../../../config/database');

const requireConfigSedesPerm = async (req, res, next) => {
    try {
        const permisoDb = await db.query(
            `SELECT 1 FROM fg_perfil_permiso 
             WHERE perfil_clave = $1 AND permiso_clave IN ('MENU_CONFIGURACION', 'CONFIGURACION_SEDES')
             GROUP BY perfil_clave
             HAVING COUNT(*) = 2`,
            [req.user.perfil_id]
        );

        if (permisoDb.rowCount === 0) {
            return res.status(403).json({ success: false, message: 'No tiene permisos para administrar sedes.' });
        }
        next();
    } catch (e) {
        res.status(500).json({ success: false, message: 'Error al verificar permisos' });
    }
};

const requireConfigServiciosPerm = async (req, res, next) => {
    try {
        const permisoDb = await db.query(
            `SELECT 1 FROM fg_perfil_permiso 
             WHERE perfil_clave = $1 AND permiso_clave IN ('MENU_CONFIGURACION', 'CONFIGURACION_SERVICIOS')
             GROUP BY perfil_clave
             HAVING COUNT(*) = 2`,
            [req.user.perfil_id]
        );

        if (permisoDb.rowCount === 0) {
            return res.status(403).json({ success: false, message: 'No tiene permisos para administrar servicios.' });
        }
        next();
    } catch (e) {
        res.status(500).json({ success: false, message: 'Error al verificar permisos' });
    }
};

const requireConfigCategoriasPerm = async (req, res, next) => {
    try {
        const permisoDb = await db.query(
            `SELECT 1 FROM fg_perfil_permiso
             WHERE perfil_clave = $1 AND permiso_clave IN ('MENU_CONFIGURACION', 'CONFIGURACION_CATEGORIAS')
             GROUP BY perfil_clave
             HAVING COUNT(*) = 2`,
            [req.user.perfil_id]
        );
        if (permisoDb.rowCount === 0) {
            return res.status(403).json({ success: false, message: 'No tiene permisos para administrar categorías.' });
        }
        next();
    } catch (e) {
        res.status(500).json({ success: false, message: 'Error al verificar permisos' });
    }
};

const requireLecturaCategoriasPerm = async (req, res, next) => {
    try {
        const permisoDb = await db.query(
            `SELECT 1 FROM fg_perfil_permiso
             WHERE perfil_clave = $1
               AND permiso_clave = 'MENU_CONFIGURACION'
               AND EXISTS (
                   SELECT 1 FROM fg_perfil_permiso fp
                   WHERE fp.perfil_clave = $1
                     AND fp.permiso_clave IN ('CONFIGURACION_CATEGORIAS', 'CONFIGURACION_SERVICIOS')
               )`,
            [req.user.perfil_id]
        );
        if (permisoDb.rowCount === 0) {
            return res.status(403).json({ success: false, message: 'No tiene permisos para consultar categorías.' });
        }
        next();
    } catch (e) {
        res.status(500).json({ success: false, message: 'Error al verificar permisos' });
    }
};

const requireConfigProductosPerm = async (req, res, next) => {
    try {
        const permisoDb = await db.query(
            `SELECT 1 FROM fg_perfil_permiso
             WHERE perfil_clave = $1
               AND permiso_clave IN ('MENU_CONFIGURACION', 'CONFIGURACION_PRODUCTOS')
             GROUP BY perfil_clave
             HAVING COUNT(*) = 2`,
            [req.user.perfil_id]
        );
        if (permisoDb.rowCount === 0) {
            return res.status(403).json({ success: false, message: 'No tiene permisos para administrar productos.' });
        }
        next();
    } catch (e) {
        res.status(500).json({ success: false, message: 'Error al verificar permisos' });
    }
};

const requireConfigTarifasPerm = async (req, res, next) => {
    try {
        const permisoDb = await db.query(
            `SELECT 1 FROM fg_perfil_permiso
             WHERE perfil_clave = $1
               AND permiso_clave IN ('MENU_CONFIGURACION', 'CONFIGURACION_TARIFAS')
             GROUP BY perfil_clave
             HAVING COUNT(DISTINCT permiso_clave) = 2`,
            [req.user.perfil_id]
        );
        if (permisoDb.rowCount === 0) {
            return res.status(403).json({ success: false, message: 'No tiene permisos para administrar tarifas.' });
        }
        next();
    } catch (e) {
        res.status(500).json({ success: false, message: 'Error al verificar permisos' });
    }
};

const requireConfigSeriesPerm = async (req, res, next) => {
    try {
        const permisoDb = await db.query(
            `SELECT 1 FROM fg_perfil_permiso
             WHERE perfil_clave = $1
               AND permiso_clave IN ('MENU_CONFIGURACION', 'CONFIGURACION_SERIES')
             GROUP BY perfil_clave
             HAVING COUNT(DISTINCT permiso_clave) = 2`,
            [req.user.perfil_id]
        );
        if (permisoDb.rowCount === 0) {
            return res.status(403).json({ success: false, message: 'No tiene permisos para administrar series.' });
        }
        next();
    } catch (e) {
        res.status(500).json({ success: false, message: 'Error al verificar permisos' });
    }
};

const requireConfigEmpresasPerm = async (req, res, next) => {
    try {
        const permisoDb = await db.query(
            `SELECT 1 FROM fg_perfil_permiso
             WHERE perfil_clave = $1
               AND permiso_clave = 'MENU_CONFIGURACION'
               AND EXISTS (
                   SELECT 1 FROM fg_perfil_permiso acceso
                   WHERE acceso.perfil_clave = $1
                     AND acceso.permiso_clave IN ('CONFIGURACION_EMPRESAS', 'CONFIGURACION_SEDES')
               )`,
            [req.user.perfil_id]
        );
        if (permisoDb.rowCount === 0) {
            return res.status(403).json({ success: false, message: 'No tiene permisos para administrar empresas.' });
        }
        next();
    } catch (_error) {
        res.status(500).json({ success: false, message: 'Error al verificar permisos' });
    }
};

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

router.get('/servicios', requireConfigServiciosPerm, configController.getServicios);
router.get('/servicios/sedes', requireConfigServiciosPerm, configController.obtenerSedesPorServicio);
router.post('/servicios', requireConfigServiciosPerm, configController.crearServicio);
router.put('/servicios/:id', requireConfigServiciosPerm, configController.editarServicio);
router.put('/servicios/:id/estado', requireConfigServiciosPerm, configController.cambiarEstadoServicio);

router.get('/categorias', requireLecturaCategoriasPerm, configController.getCategorias);
router.post('/categorias', requireConfigCategoriasPerm, configController.crearCategoria);
router.put('/categorias/:id', requireConfigCategoriasPerm, configController.editarCategoria);
router.put('/categorias/:id/estado', requireConfigCategoriasPerm, configController.cambiarEstadoCategoria);

router.get('/productos', requireConfigProductosPerm, productosController.listar);
router.post('/productos', requireConfigProductosPerm, productosController.crear);
router.put('/productos/:id', requireConfigProductosPerm, productosController.editar);
router.put('/productos/:id/estado', requireConfigProductosPerm, productosController.cambiarEstado);

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
router.get('/series', requireConfigSeriesPerm, seriesController.listar);
router.post('/series', requireConfigSeriesPerm, seriesController.crear);
router.put('/series/:id', requireConfigSeriesPerm, seriesController.editar);
router.put('/series/:id/estado', requireConfigSeriesPerm, seriesController.cambiarEstado);
router.put('/series/:id/confirmacion-produccion', requireConfigSeriesPerm, seriesController.confirmarProduccion);

module.exports = router;
