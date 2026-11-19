const express = require('express');
const db = require('../../../config/database');
const { authFaregasMiddleware } = require('../middlewares/faregas-auth.middleware');
const { crearMiddlewarePermisoFaregas } = require('../middlewares/faregas-permisos.middleware');
const controller = require('../controllers/faregas-chips.controller');
const documentosElectronicosController = require('../controllers/faregas-documentos-electronicos.controller');
const router = express.Router();

const permiso = (...claves) => crearMiddlewarePermisoFaregas(db, {
    anyOf: claves,
    message: 'No tiene permiso para esta operación de chips.'
});

// El submódulo es la autorización ordinaria: el middleware central hace que
// MENU_CHIPS_* cubra sus CHIPS_* habituales. Se sigue exigiendo el submódulo
// correspondiente, también al entrar por URL directa.
const inventario = (...operativo) => [permiso('MENU_CHIPS_INVENTARIO'), permiso(...operativo)];
const tipos = (...operativo) => [permiso('MENU_CHIPS_TIPOS'), permiso(...operativo)];
const ventas = (...operativo) => [permiso('MENU_CHIPS_VENTAS'), permiso(...operativo)];
const requiereAnulacionFiscalChips = crearMiddlewarePermisoFaregas(db, {
    allOf: ['MENU_CHIPS_VENTAS', 'FAREGAS_ANULAR_COMPROBANTE'],
    message: 'No tiene autorización para anular comprobantes electrónicos.'
});

router.use(authFaregasMiddleware);
router.get('/productos/catalogos', permiso('MENU_CHIPS_TIPOS', 'MENU_CHIPS_INVENTARIO'), permiso('CHIPS_VER', 'CHIPS_CONFIGURAR'), controller.catalogosProductosInventariables);
router.get('/productos', permiso('MENU_CHIPS_TIPOS', 'MENU_CHIPS_INVENTARIO'), permiso('CHIPS_VER', 'CHIPS_CONFIGURAR'), controller.listarProductosInventariables);
// El wizard de venta necesita leer los productos habilitados para la sede,
// pero ese acceso no concede administración de inventario ni de catálogo.
router.get('/productos/venta', ...ventas('CHIPS_VER'), controller.listarProductosVendibles);
router.post('/productos',...tipos('CHIPS_CONFIGURAR'),controller.crearProductoInventariable);
router.put('/productos/:id',...tipos('CHIPS_CONFIGURAR'),controller.editarProductoInventariable);
router.get('/productos/:id/impacto',...tipos('CHIPS_CONFIGURAR'),controller.impactoProductoInventariable);
router.delete('/productos/:id',...tipos('CHIPS_CONFIGURAR'),controller.eliminarProductoInventariable);
router.get('/',...inventario('CHIPS_VER'),controller.listar);
router.get('/resumen',...inventario('CHIPS_VER'),controller.resumen);
// Se consulta desde el wizard de NuevoCertificado, no desde Chips: conserva el
// permiso amplio que tenía para no afectar el flujo de certificados.
router.get('/disponibilidad/:numeroChip',permiso('MENU_INICIO', 'MENU_CHIPS_INVENTARIO'),controller.consultarDisponibilidad);
router.post('/ingresos/proponer-codigos',...inventario('CHIPS_INGRESAR'),controller.proponerCodigosDisponibles);
router.post('/ingresos',...inventario('CHIPS_INGRESAR'),controller.ingresar);
router.post('/inventario-cantidad/ingresos',...inventario('CHIPS_INGRESAR'),controller.ingresarCantidad);
router.get('/inventario-cantidad/:productoInventariableId/movimientos',...inventario('CHIPS_VER'),controller.listarMovimientosCantidad);
router.post('/transferencias',...inventario('CHIPS_TRANSFERIR'),controller.transferir);
// Lectura: consultar el histórico de ventas.
router.get('/ventas',...ventas('CHIPS_VER'),controller.listarVentas);
router.get('/ventas/:operacionId',...ventas('CHIPS_VER'),controller.obtenerDetalleVenta);
router.post('/ventas/:operacionId/facturacion/anulaciones',requiereAnulacionFiscalChips,documentosElectronicosController.generarAnulacionOperacion);
router.post('/ventas/:operacionId/facturacion/anulaciones/:anulacionId/consultar',...ventas('CHIPS_VER'),documentosElectronicosController.consultarAnulacionOperacion);
// Escritura: reservar/liberar, validar y registrar la venta con su comprobante.
router.post('/reservas',...ventas('CHIPS_VENDER'),controller.reservar);
router.post('/liberaciones',...ventas('CHIPS_VENDER'),controller.liberar);
router.post('/ventas',...ventas('CHIPS_VENDER'),controller.vender);
router.post('/venta-directa/validar',...ventas('CHIPS_VENDER'),controller.validarVentaDirecta);
router.post('/venta-directa',...ventas('CHIPS_VENDER'),controller.crearVentaDirecta);
router.post('/bajas',...inventario('CHIPS_BAJA'),controller.baja);
// Catálogo fiscal compartido con Configuración > Productos: conserva el permiso
// amplio original para no afectar ese módulo.
router.get('/catalogo-fiscales', permiso('MENU_CHIPS_TIPOS','MENU_CHIPS_INVENTARIO','CONFIGURACION_PRODUCTOS'), controller.listarCatalogoChipsFiscales);
router.get('/:id/movimientos',...inventario('CHIPS_VER'),controller.historial);
module.exports=router;
