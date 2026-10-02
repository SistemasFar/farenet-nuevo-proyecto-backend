const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const MIGRACION = path.join(
    __dirname, '..', 'database', 'migrations',
    '20261002_faregas_permiso_configuracion_submodulos.sql'
);
const sql = fs.readFileSync(MIGRACION, 'utf8');
const permisos = [
    'MENU_CONFIGURACION_SEDES',
    'MENU_CONFIGURACION_CATALOGO',
    'MENU_CONFIGURACION_TARIFAS',
    'MENU_CONFIGURACION_CORRELATIVOS',
    'MENU_CONFIGURACION_EMPRESAS'
];

test('registra los cinco submódulos de Configuración como permisos MENU', () => {
    for (const permiso of permisos) {
        assert.match(sql, new RegExp(`\\('${permiso}',\\s*'[^']+',\\s*'MENU'`));
    }
});

test('la migración es idempotente y no elimina permisos', () => {
    assert.match(sql, /ON CONFLICT \(clave\) DO UPDATE/);
    assert.match(sql, /ON CONFLICT DO NOTHING/);
    assert.doesNotMatch(sql, /DELETE\s+FROM/i);
    assert.doesNotMatch(sql, /UPDATE\s+fg_perfil_permiso/i);
});

test('el backfill exige el padre y conserva el alcance operativo anterior', () => {
    assert.match(sql, /padre\.permiso_clave = 'MENU_CONFIGURACION'/);
    for (const operativo of [
        'CONFIGURACION_SEDES',
        'CONFIGURACION_CATEGORIAS',
        'CONFIGURACION_SERVICIOS',
        'CONFIGURACION_PRODUCTOS',
        'CONFIGURACION_TARIFAS',
        'CONFIGURACION_SERIES',
        'CONFIGURACION_EMPRESAS'
    ]) {
        assert.match(sql, new RegExp(`'${operativo}'`));
    }
});
