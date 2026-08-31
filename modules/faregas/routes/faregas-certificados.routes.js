const express = require('express');
const router = express.Router();
const controller = require('../controllers/faregas-certificados.controller');
const pagosController = require('../controllers/faregas-pagos.controller');
const facturacionController = require('../controllers/faregas-facturacion.controller');
const documentosElectronicosController = require('../controllers/faregas-documentos-electronicos.controller');
const facturacionAdminController = require('../controllers/faregas-facturacion-admin.controller');
const jwt = require('jsonwebtoken');
const db = require('../../../config/database');

const JWT_SECRET_FAREGAS = process.env.JWT_SECRET_FAREGAS;

const authMiddleware = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ message: 'Token requerido' });
    }
    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, JWT_SECRET_FAREGAS);
        if (decoded.faregas_flow !== 'authenticated') {
            return res.status(403).json({ message: 'Flujo inválido' });
        }
        
        const userDb = await db.query(
            'SELECT estado, perfil_id FROM fg_usuario WHERE username = $1 LIMIT 1', 
            [decoded.username]
        );
        
        if (userDb.rowCount === 0) {
            return res.status(401).json({ message: 'Usuario no existe' });
        }
        if (!userDb.rows[0].estado) {
            return res.status(403).json({ message: 'Usuario inactivo' });
        }
        
        req.user = decoded;
        next();
    } catch (e) {
        return res.status(401).json({ message: 'Token inválido o expirado' });
    }
};

router.use(authMiddleware);

const facturacionAdminMiddleware = async (req, res, next) => {
    if (req.user?.perfil_id === 'SISTEMAS') return next();
    try {
        const permiso = await db.query(`
            SELECT 1 FROM fg_perfil_permiso
            WHERE perfil_clave = $1
              AND permiso_clave IN ('MENU_CONFIGURACION', 'CONFIGURACION_SERIES')
            LIMIT 1
        `, [req.user?.perfil_id]);
        if (permiso.rowCount === 0) return res.status(403).json({ message: 'No tiene permiso para consultar comprobantes.' });
        return next();
    } catch (error) {
        console.error('[FAREGAS FACTURACION ADMIN AUTH]', error);
        return res.status(500).json({ message: 'No se pudo validar el permiso de facturación.' });
    }
};

// Catálogo
router.get('/catalogos/verificaciones', controller.obtenerCatalogoVerificaciones);

router.get('/tipos', controller.obtenerTipos);
router.get('/correlativos', controller.obtenerCorrelativos);
router.get('/correlativos/:plantaKey/:tipo', controller.obtenerRangoActivo);
router.post('/correlativos', controller.crearRango);
router.patch('/correlativos/:id', controller.actualizarRango);
router.patch('/correlativos/:id/cerrar', controller.cerrarRango);

// FASE 3: BORRADORES DE CERTIFICADOS
router.get('/borradores', controller.obtenerBorradores);
router.post('/borradores', controller.crearBorrador);
router.get('/borradores/:id', controller.obtenerBorradorCompleto);
router.patch('/borradores/:id', controller.actualizarBorrador);
router.patch('/borradores/:id/paso', controller.actualizarPasoBorrador);

router.put('/borradores/:id/vehiculo', controller.guardarVehiculoBorrador);

router.post('/borradores/:id/titulares', controller.agregarTitular);
router.patch('/borradores/:id/titulares/:titularId', controller.actualizarTitular);
router.delete('/borradores/:id/titulares/:titularId', controller.eliminarTitular);

// FASE 4: DATOS ESPECÍFICOS DE CERTIFICADOS

// GNV
router.put('/borradores/:id/gnv', controller.guardarGNV);
router.put('/borradores/:id/gnv/componentes', controller.guardarGNVComponentes);
router.put('/borradores/:id/gnv/verificaciones', controller.guardarGNVVerificaciones);
router.get('/borradores/:id/gnv', controller.obtenerGNV);

// GLP
router.put('/borradores/:id/glp', controller.guardarGLP);
router.put('/borradores/:id/glp/componentes', controller.guardarGLPComponentes);
router.put('/borradores/:id/glp/verificaciones', controller.guardarGLPVerificaciones);
router.get('/borradores/:id/glp', controller.obtenerGLP);

// CONFORMIDAD
router.put('/borradores/:id/conformidad', controller.guardarConformidad);
router.get('/borradores/:id/conformidad', controller.obtenerConformidad);

// PAGOS
router.get('/borradores/:id/pagos', pagosController.obtenerPagos);
router.put('/borradores/:id/pagos', pagosController.guardarPagos);

// FACTURACION ELECTRONICA
router.get('/facturacion/admin/documentos', facturacionAdminMiddleware, facturacionAdminController.listar);
router.get('/facturacion/admin/documentos/:facturacionId', facturacionAdminMiddleware, facturacionAdminController.obtenerDetalle);
router.get('/borradores/:id/facturacion', facturacionController.obtener);
router.put('/borradores/:id/facturacion', facturacionController.guardar);
router.post('/borradores/:id/facturacion/emitir', facturacionController.emitir);
router.get('/borradores/:id/facturacion/documentos', documentosElectronicosController.listar);
router.post('/borradores/:id/facturacion/consultar', documentosElectronicosController.consultarComprobante);
router.post('/borradores/:id/facturacion/notas', documentosElectronicosController.emitirNota);
router.post('/borradores/:id/facturacion/notas/:tipo/:notaId/emitir', documentosElectronicosController.reintentarNota);
router.post('/borradores/:id/facturacion/anulaciones', documentosElectronicosController.generarAnulacion);
router.post('/borradores/:id/facturacion/anulaciones/:anulacionId/consultar', documentosElectronicosController.consultarAnulacion);

// PREVISUALIZACIÓN Y EMISIÓN
router.get('/borradores/:id/previsualizacion', controller.obtenerPrevisualizacion);
router.get('/borradores/:id/validar-emision', controller.validarEmision);
router.post('/borradores/:id/emitir', controller.emitir);

// TALLERES
router.get('/talleres', controller.obtenerTalleresActivos);

module.exports = router;
