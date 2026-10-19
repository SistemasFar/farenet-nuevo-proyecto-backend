const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const backendRoot = path.join(__dirname, '..');
const workspaceRoot = path.join(backendRoot, '..', '..', '..');

test('Clientes tiene un permiso de Facturación independiente y compatible', () => {
    const migration = fs.readFileSync(path.join(
        backendRoot,
        'database/migrations_history/20261016_faregas_permiso_facturacion_clientes.sql'
    ), 'utf8');
    const route = fs.readFileSync(path.join(backendRoot, 'routes/faregas-clientes.routes.js'), 'utf8');
    const facturacion = fs.readFileSync(path.join(
        workspaceRoot,
        'farenetFrontend/src/modules/faregas/views/Configuracion/components/TabFacturacion.tsx'
    ), 'utf8');
    const usuarios = fs.readFileSync(path.join(
        workspaceRoot,
        'farenetFrontend/src/modules/faregas/views/Usuarios/UsuariosView.tsx'
    ), 'utf8');

    assert.match(migration, /'MENU_FACTURACION_CLIENTES'/);
    assert.match(migration, /WHERE permiso_clave = 'MENU_FACTURACION_COMPROBANTES'/);
    assert.match(route, /permiso_clave = 'MENU_FACTURACION_CLIENTES'/);
    assert.match(facturacion, /id: 'CLIENTES', permiso: 'MENU_FACTURACION_CLIENTES'/);
    assert.match(usuarios, /'MENU_FACTURACION_CLIENTES'/);
});
