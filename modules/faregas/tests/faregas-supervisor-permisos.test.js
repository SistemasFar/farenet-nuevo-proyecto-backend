const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const backendRoot = path.join(__dirname, '..');
const migrationPath = path.join(
    backendRoot,
    'database/migrations_history/20261019_faregas_supervisor_permisos_operativos.sql'
);

const obtenerPermisosSupervisor = () => {
    const migration = fs.readFileSync(migrationPath, 'utf8');
    return new Set(Array.from(
        migration.matchAll(/\('SUPERVISOR',\s*'([^']+)'\)/g),
        (match) => match[1]
    ));
};

test('SUPERVISOR recibe navegacion y capacidades para los modulos operativos', () => {
    const permisos = obtenerPermisosSupervisor();
    const esperados = [
        'MENU_DESCUENTOS',
        'DESCUENTOS_ADMINISTRAR',
        'MENU_CHIPS',
        'MENU_CHIPS_INVENTARIO',
        'MENU_CHIPS_TIPOS',
        'MENU_CHIPS_VENTAS',
        'CHIPS_VER',
        'CHIPS_INGRESAR',
        'CHIPS_TRANSFERIR',
        'CHIPS_CONFIGURAR',
        'CHIPS_VENDER',
        'CHIPS_BAJA',
        'MENU_CONFIGURACION',
        'MENU_CONFIGURACION_SEDES',
        'MENU_CONFIGURACION_CATALOGO',
        'MENU_CONFIGURACION_TARIFAS',
        'MENU_CONFIGURACION_CORRELATIVOS',
        'MENU_CONFIGURACION_EMPRESAS',
        'CONFIGURACION_SEDES',
        'CONFIGURACION_CATEGORIAS',
        'CONFIGURACION_SERVICIOS',
        'CONFIGURACION_PRODUCTOS',
        'CONFIGURACION_TARIFAS',
        'CONFIGURACION_SERIES',
        'CONFIGURACION_EMPRESAS'
    ];

    assert.deepEqual([...permisos].sort(), esperados.sort());
});

test('SUPERVISOR no recibe administracion de usuarios, auditoria ni privilegios globales', () => {
    const permisos = obtenerPermisosSupervisor();
    const restringidos = [
        'MENU_USUARIOS',
        'MENU_AUDITORIA',
        'MENU_DASHBOARD',
        'DASHBOARD_GLOBAL',
        'DASHBOARD_EXPORTAR',
        'FAREGAS_NOTA_CREDITO'
    ];

    for (const permiso of restringidos) {
        assert.equal(permisos.has(permiso), false, `${permiso} no debe otorgarse`);
    }
});
