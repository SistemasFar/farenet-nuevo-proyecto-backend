const express = require('express');
const router = express.Router();
const controller = require('../controllers/faregas-certificados.controller');
const correlativosController = require('../controllers/faregas-certificados-correlativos.controller');
const pagosController = require('../controllers/faregas-pagos.controller');
const facturacionController = require('../controllers/faregas-facturacion.controller');
const documentosElectronicosController = require('../controllers/faregas-documentos-electronicos.controller');
const facturacionAdminController = require('../controllers/faregas-facturacion-admin.controller');
const nubefactReadinessController = require('../controllers/faregas-nubefact-readiness.controller');
const jwt = require('jsonwebtoken');
const db = require('../../../config/database');
const { crearMiddlewarePermisoFaregas } = require('../middlewares/faregas-permisos.middleware');

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
        
        // El perfil puede haberse actualizado mientras la sesión seguía activa.
        // Usar el valor verificado en PostgreSQL evita evaluar permisos de planta
        // con un perfil obsoleto incluido en el JWT.
        req.user = { ...decoded, perfil_id: userDb.rows[0].perfil_id };
        next();
    } catch (e) {
        return res.status(401).json({ message: 'Token inválido o expirado' });
    }
};

router.use(authMiddleware);

const permisoInicio = crearMiddlewarePermisoFaregas(db, {
    anyOf: ['MENU_INICIO'],
    message: 'No tiene permiso para consultar o gestionar certificados.'
});
const permisoCorrelativosConfiguracion = crearMiddlewarePermisoFaregas(db, {
    // La vista actual de Correlativos también forma parte del acceso
    // Facturación > Series; ambos son permisos de submódulo explícitos.
    anyOf: ['CONFIGURACION_SERIES', 'MENU_FACTURACION_SERIES'],
    message: 'No tiene permiso para gestionar correlativos de certificados.'
});
// Facturación electrónica y Configuración son ámbitos separados. Solo el
// submódulo Comprobantes abre estas consultas administrativas.
const facturacionAdminMiddleware = crearMiddlewarePermisoFaregas(db, {
    anyOf: ['MENU_FACTURACION_COMPROBANTES'],
    message: 'No tiene permiso para consultar comprobantes.'
});

// Borradores y su facturación pertenecen al flujo Inicio. Los controles
// fiscales sensibles siguen validándose dentro de los servicios respectivos.
router.use('/borradores', permisoInicio);

// Catálogo
router.get('/operaciones-disponibles', permisoInicio, controller.obtenerOperacionesDisponibles);
router.get('/catalogos/verificaciones', permisoInicio, controller.obtenerCatalogoVerificaciones);

router.get('/tipos', permisoInicio, controller.obtenerTipos);

// --- Correlativos por SEDE (modelo vigente) -------------------------------
// Un rango pertenece a la sede. No se pide tipo, modalidad ni producto, ni al
// listar ni al crear. Las rutas del modelo anterior quedan debajo para no
// romper clientes que aún las consulten; la emisión usa las de aquí.
router.get('/correlativos-sede', permisoCorrelativosConfiguracion, correlativosController.listarRangosSede);
router.get('/correlativos-sede/resumen', permisoCorrelativosConfiguracion, correlativosController.resumenRangosSede);
router.get('/correlativos-sede/auditoria', permisoCorrelativosConfiguracion, correlativosController.auditarRangosSede);
router.get('/correlativos-sede/sugerencia', permisoCorrelativosConfiguracion, correlativosController.sugerirRangoSede);
router.post('/correlativos-sede', permisoCorrelativosConfiguracion, correlativosController.agregarRangoSede);
router.patch('/correlativos-sede/:id', permisoCorrelativosConfiguracion, correlativosController.editarRangoSede);
router.patch('/correlativos-sede/:id/cerrar', permisoCorrelativosConfiguracion, correlativosController.cerrarRangoSede);

// --- Modelo anterior, conservado ------------------------------------------
router.get('/correlativos', permisoCorrelativosConfiguracion, controller.obtenerCorrelativos);
router.get('/correlativos/:plantaKey/:tipo', permisoCorrelativosConfiguracion, controller.obtenerRangoActivo);
router.post('/correlativos', permisoCorrelativosConfiguracion, controller.crearRango);
router.patch('/correlativos/:id', permisoCorrelativosConfiguracion, controller.actualizarRango);
router.patch('/correlativos/:id/cerrar', permisoCorrelativosConfiguracion, controller.cerrarRango);
router.get('/correlativos-plan/auditoria', permisoCorrelativosConfiguracion, controller.auditarCorrelativos);
router.get('/correlativos-plan/plan', permisoCorrelativosConfiguracion, controller.obtenerPlanCorrelativos);
router.post('/correlativos-plan/aplicar', permisoCorrelativosConfiguracion, controller.aplicarPlanCorrelativos);
router.get('/correlativos-plan/siguiente', permisoCorrelativosConfiguracion, controller.sugerirSiguienteRango);

// FASE 3: BORRADORES DE CERTIFICADOS
router.get('/borradores', controller.obtenerBorradores);
router.post('/borradores', controller.crearBorrador);
router.get('/borradores/:id', controller.obtenerBorradorCompleto);
router.patch('/borradores/:id', controller.actualizarBorrador);
router.patch('/borradores/:id/paso', controller.actualizarPasoBorrador);
router.patch('/borradores/:id/anular', controller.anularBorrador);
router.get('/borradores/:id/chip', controller.obtenerChipBorrador);
router.put('/borradores/:id/chip', controller.seleccionarChipBorrador);

router.put('/borradores/:id/vehiculo', controller.guardarVehiculoBorrador);
router.put('/borradores/:id/vehiculo/confirmar', controller.confirmarVehiculoBorrador);

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
router.get('/facturacion/admin/readiness', facturacionAdminMiddleware, nubefactReadinessController.obtenerPanel);
router.get('/facturacion/admin/documentos/:facturacionId', facturacionAdminMiddleware, facturacionAdminController.obtenerDetalle);
router.post('/facturacion/admin/documentos/:facturacionId/detraccion-constancia', facturacionAdminMiddleware, facturacionAdminController.registrarConstanciaDetraccion);
router.get('/borradores/:id/facturacion', facturacionController.obtener);
router.get('/borradores/:id/facturacion/preflight', facturacionController.preflight);
router.put('/borradores/:id/facturacion', facturacionController.guardar);
router.post('/borradores/:id/facturacion/emitir', facturacionController.emitir);
router.get('/borradores/:id/facturacion/documentos', documentosElectronicosController.listar);
router.get('/borradores/:id/facturacion/notas/contexto', documentosElectronicosController.obtenerContextoNotaCredito);
router.post('/borradores/:id/facturacion/consultar', documentosElectronicosController.consultarComprobante);
router.post('/borradores/:id/facturacion/notas', documentosElectronicosController.emitirNota);
router.post('/borradores/:id/facturacion/notas/:tipo/:notaId/consultar', documentosElectronicosController.consultarNota);
router.post('/borradores/:id/facturacion/notas/:tipo/:notaId/emitir', documentosElectronicosController.reintentarNota);
router.get('/borradores/:id/facturacion/notas/credito/:notaId/pdf', documentosElectronicosController.descargarPdfNotaCredito);
router.post('/borradores/:id/facturacion/anulaciones', documentosElectronicosController.generarAnulacion);
router.post('/borradores/:id/facturacion/anulaciones/:anulacionId/consultar', documentosElectronicosController.consultarAnulacion);
router.get('/borradores/:id/facturacion/pdf', facturacionController.descargarPdfFaregas);
router.get('/borradores/:id/facturacion/pdf-nubefact', facturacionController.descargarPdfNubefact);
router.get('/borradores/:id/facturacion/html', facturacionController.obtenerHtmlFaregas);
router.post('/borradores/:id/facturacion/regenerar-pdf', facturacionController.regenerarPdfFaregas);
router.get('/facturacion/:facturacionId/pdf', facturacionAdminMiddleware, facturacionController.descargarPdfFaregasPorFacturacionId);
router.post('/facturacion/:facturacionId/regenerar-pdf', facturacionAdminMiddleware, facturacionController.regenerarPdfFaregasPorFacturacionId);

// PREVISUALIZACIÓN Y EMISIÓN
//
// Estas rutas NO pasan por facturacionAdminMiddleware, y a propósito: emitir un
// certificado desde el wizard es una operación operativa, no administración del
// módulo Facturación. Un perfil sin MENU_FACTURACION_SERIES debe poder seguir
// emitiendo sus certificados igual que antes de dividir los permisos.
router.get('/borradores/:id/previsualizacion', controller.obtenerPrevisualizacion);
router.get('/borradores/:id/certificado/pdf', controller.descargarPdfCertificado);
router.get('/borradores/:id/validar-emision', controller.validarEmision);
router.post('/borradores/:id/emitir', controller.emitir);

// TALLER INSPECCION
router.put('/borradores/:id/snapshot', controller.guardarTaller);

// TALLERES
router.get('/talleres', permisoInicio, controller.obtenerTalleresActivos);

// RECTIFICACIÓN TÉCNICA DE CERTIFICADOS EMITIDOS
// El endpoint directo actualiza y versiona el certificado sin solicitudes,
// comprobantes nuevos ni consumo de correlativos. Las rutas administrativas se
// conservan separadas para el historial y los procesos que todavía las usan.
const rectificacionesController = require('../controllers/faregas-rectificaciones.controller');
router.get('/:id/rectificacion/contexto', permisoInicio, rectificacionesController.contexto);
router.get('/:id/rectificacion/historial', permisoInicio, rectificacionesController.historial);
router.post('/:id/rectificacion/previsualizacion', permisoInicio, rectificacionesController.previsualizar);
router.post('/:id/rectificacion/directa', permisoInicio, rectificacionesController.ejecutarDirecta);
router.post('/:id/rectificacion', permisoInicio, rectificacionesController.crear);
router.get('/:id/rectificacion/versiones/:versionId/pdf', permisoInicio, rectificacionesController.descargarPdfVersion);

module.exports = router;
