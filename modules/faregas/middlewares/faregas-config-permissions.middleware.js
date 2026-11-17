const { crearMiddlewarePermisoFaregas } = require('./faregas-permisos.middleware');

const createFaregasConfigPermissionGuards = (db) => ({
    requireConfigSedesPerm: crearMiddlewarePermisoFaregas(db, {
        anyOf: ['CONFIGURACION_SEDES'], message: 'No tiene permisos para administrar sedes.'
    }),
    requireConfigServiciosPerm: crearMiddlewarePermisoFaregas(db, {
        anyOf: ['CONFIGURACION_SERVICIOS'], message: 'No tiene permisos para administrar servicios.'
    }),
    // Productos usa servicios y sedes de servicio como datos de relación de solo lectura.
    requireConfigServiciosOProductosPerm: crearMiddlewarePermisoFaregas(db, {
        anyOf: ['CONFIGURACION_SERVICIOS', 'CONFIGURACION_PRODUCTOS'],
        message: 'No tiene permisos para consultar servicios.'
    }),
    requireConfigCategoriasPerm: crearMiddlewarePermisoFaregas(db, {
        anyOf: ['CONFIGURACION_CATEGORIAS'], message: 'No tiene permisos para administrar categorías.'
    }),
    requireLecturaCategoriasPerm: crearMiddlewarePermisoFaregas(db, {
        anyOf: ['CONFIGURACION_CATEGORIAS', 'CONFIGURACION_SERVICIOS', 'CONFIGURACION_PRODUCTOS'],
        message: 'No tiene permisos para consultar categorías.'
    }),
    requireConfigProductosPerm: crearMiddlewarePermisoFaregas(db, {
        anyOf: ['CONFIGURACION_PRODUCTOS'], message: 'No tiene permisos para administrar productos.'
    }),
    requireConfigTarifasPerm: crearMiddlewarePermisoFaregas(db, {
        anyOf: ['CONFIGURACION_TARIFAS'], message: 'No tiene permisos para administrar tarifas.'
    }),
    // Se acepta el permiso de Series propio de Facturación o el permiso administrativo equivalente.
    requireConfigSeriesPerm: crearMiddlewarePermisoFaregas(db, {
        anyOf: ['CONFIGURACION_SERIES', 'MENU_FACTURACION_SERIES'],
        message: 'No tiene permisos para administrar series.'
    }),
    requireConfigEmpresasPerm: crearMiddlewarePermisoFaregas(db, {
        anyOf: ['CONFIGURACION_EMPRESAS'],
        message: 'No tiene permisos para administrar empresas.'
    }),
});

module.exports = { createFaregasConfigPermissionGuards };
