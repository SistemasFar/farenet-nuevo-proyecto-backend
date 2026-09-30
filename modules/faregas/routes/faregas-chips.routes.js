const express = require('express');
const db = require('../../../config/database');
const { authFaregasMiddleware } = require('../middlewares/faregas-auth.middleware');
const controller = require('../controllers/faregas-chips.controller');
const documentosElectronicosController = require('../controllers/faregas-documentos-electronicos.controller');
const router = express.Router();

const permiso = (...claves) => async(req,res,next)=>{
    try{
        const r=await db.query('SELECT 1 FROM fg_perfil_permiso WHERE perfil_clave=$1 AND permiso_clave=ANY($2::varchar[]) LIMIT 1',[req.user.perfil_id,claves]);
        if(!r.rowCount)return res.status(403).json({success:false,message:'No tiene permiso para esta operación de chips.'}); next();
    }catch(e){res.status(500).json({success:false,message:'No se pudo validar el permiso.'});}
};

// Submódulos de navegación (MENU_CHIPS_*). Son la puerta de entrada al
// submódulo y NO sustituyen a los CHIPS_* operativos, que se siguen exigiendo.
// Un perfil sin el submódulo recibe 403 aunque escriba la URL a mano, y un
// perfil con el submódulo pero sin el permiso operativo tampoco puede operar.
// Los dos middlewares se encadenan: ambos tienen que pasar.
const inventario = (...operativo) => [permiso('MENU_CHIPS_INVENTARIO'), permiso(...operativo)];
const tipos = (...operativo) => [permiso('MENU_CHIPS_TIPOS'), permiso(...operativo)];
const ventas = (...operativo) => [permiso('MENU_CHIPS_VENTAS'), permiso(...operativo)];

router.use(authFaregasMiddleware);
router.get('/productos/catalogos',...tipos('CHIPS_CONFIGURAR'),controller.catalogosProductosInventariables);
router.get('/productos',...tipos('CHIPS_CONFIGURAR'),controller.listarProductosInventariables);
router.post('/productos',...tipos('CHIPS_CONFIGURAR'),controller.crearProductoInventariable);
router.put('/productos/:id',...tipos('CHIPS_CONFIGURAR'),controller.editarProductoInventariable);
router.get('/productos/:id/impacto',...tipos('CHIPS_CONFIGURAR'),controller.impactoProductoInventariable);
router.delete('/productos/:id',...tipos('CHIPS_CONFIGURAR'),controller.eliminarProductoInventariable);
router.get('/',...inventario('CHIPS_VER'),controller.listar);
router.get('/resumen',...inventario('CHIPS_VER'),controller.resumen);
// Se consulta desde el wizard de NuevoCertificado, no desde Chips: conserva el
// permiso amplio que tenía para no afectar el flujo de certificados.
router.get('/disponibilidad/:numeroChip',controller.consultarDisponibilidad);
router.post('/ingresos',...inventario('CHIPS_INGRESAR'),controller.ingresar);
router.post('/transferencias',...inventario('CHIPS_TRANSFERIR'),controller.transferir);
// Lectura: consultar el histórico de ventas.
router.get('/ventas',...ventas('CHIPS_VER'),controller.listarVentas);
router.get('/ventas/:operacionId',...ventas('CHIPS_VER'),controller.obtenerDetalleVenta);
router.post('/ventas/:operacionId/facturacion/anulaciones',...ventas('CHIPS_VENDER'),documentosElectronicosController.generarAnulacionOperacion);
router.post('/ventas/:operacionId/facturacion/anulaciones/:anulacionId/consultar',...ventas('CHIPS_VENDER'),documentosElectronicosController.consultarAnulacionOperacion);
// Escritura: reservar/liberar, validar y registrar la venta con su comprobante.
router.post('/reservas',...ventas('CHIPS_VENDER'),controller.reservar);
router.post('/liberaciones',...ventas('CHIPS_VENDER'),controller.liberar);
router.post('/ventas',...ventas('CHIPS_VENDER'),controller.vender);
router.post('/venta-directa/validar',...ventas('CHIPS_VENDER'),controller.validarVentaDirecta);
router.post('/venta-directa',...ventas('CHIPS_VENDER'),controller.crearVentaDirecta);
router.post('/bajas',...inventario('CHIPS_BAJA'),controller.baja);
// Catálogo fiscal compartido con Configuración > Productos: conserva el permiso
// amplio original para no afectar ese módulo.
router.get('/catalogo-fiscales', permiso('MENU_CHIPS','CHIPS_VER','MENU_CONFIGURACION','CONFIGURACION_PRODUCTOS'), controller.listarCatalogoChipsFiscales);
router.get('/:id/movimientos',...inventario('CHIPS_VER'),controller.historial);
module.exports=router;
