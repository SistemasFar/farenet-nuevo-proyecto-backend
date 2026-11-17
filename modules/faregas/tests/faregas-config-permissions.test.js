const test = require('node:test');
const assert = require('node:assert/strict');
const { createFaregasConfigPermissionGuards } = require('../middlewares/faregas-config-permissions.middleware');

const makeDb = ({ granted = {}, active, users = {}, states = {}, fail = false } = {}) => ({
    async query(sql, params) {
        if (fail) throw new Error('database unavailable');
        if (/FROM public\.fg_usuario/.test(sql)) {
            const username = params[0];
            if (states[username] === 'MISSING') return { rows: [], rowCount: 0 };
            return { rows: [{ username, perfil_id: users[username] || username, estado: states[username] !== false }], rowCount: 1 };
        }
        const profile = params[0];
        const profileGrants = new Set(granted[profile] || []);
        const activePermissions = new Set(active ?? Object.values(granted).flat());
        const rows = [...profileGrants].filter((key) => activePermissions.has(key)).map((permiso_clave) => ({ permiso_clave }));
        return { rows, rowCount: rows.length };
    }
});

const invoke = async (middleware, username, perfilToken = username) => {
    const result = { statusCode: null, body: null, next: false };
    const req = { user: { username, perfil_id: perfilToken } };
    const res = {
        status(code) { result.statusCode = code; return this; },
        json(body) { result.body = body; return this; },
    };
    await middleware(req, res, () => { result.next = true; });
    return result;
};

test('CONFIGURACION_PRODUCTOS basta aunque el perfil no tenga MENU_CONFIGURACION', async () => {
    const guards = createFaregasConfigPermissionGuards(makeDb({
        granted: { OPERADOR: ['CONFIGURACION_PRODUCTOS'] }, users: { op: 'OPERADOR' },
    }));

    assert.deepEqual(await invoke(guards.requireConfigProductosPerm, 'OPERADOR'), {
        statusCode: null, body: null, next: true,
    });
});

test('MENU_CONFIGURACION por sí solo no habilita operaciones de productos', async () => {
    const guards = createFaregasConfigPermissionGuards(makeDb({
        granted: { CONTADOR: ['MENU_CONFIGURACION'] },
    }));

    const result = await invoke(guards.requireConfigProductosPerm, 'CONTADOR');
    assert.equal(result.statusCode, 403);
    assert.equal(result.next, false);
});

test('MENU_CONFIGURACION_CATALOGO habilita el catálogo sin requerir llaves CONFIGURACION_* duplicadas', async () => {
    const guards = createFaregasConfigPermissionGuards(makeDb({
        granted: { CONTADOR: ['MENU_CONFIGURACION_CATALOGO'] },
    }));

    assert.equal((await invoke(guards.requireConfigProductosPerm, 'CONTADOR')).next, true);
    assert.equal((await invoke(guards.requireConfigServiciosPerm, 'CONTADOR')).next, true);
    assert.equal((await invoke(guards.requireConfigCategoriasPerm, 'CONTADOR')).next, true);
});

test('MENU_CONFIGURACION_CORRELATIVOS habilita el acceso ordinario a Series', async () => {
    const guards = createFaregasConfigPermissionGuards(makeDb({
        granted: { CONTADOR: ['MENU_CONFIGURACION_CORRELATIVOS'] },
    }));

    assert.equal((await invoke(guards.requireConfigSeriesPerm, 'CONTADOR')).next, true);
});

test('usa el perfil vigente de PostgreSQL, no el perfil posiblemente antiguo del token', async () => {
    const guards = createFaregasConfigPermissionGuards(makeDb({
        granted: { OPERADOR: ['CONFIGURACION_PRODUCTOS'] }, users: { op: 'OPERADOR' },
    }));

    assert.equal((await invoke(guards.requireConfigProductosPerm, 'op', 'CONTADOR')).next, true);
});

test('tener solo Productos no concede administración de Servicios', async () => {
    const guards = createFaregasConfigPermissionGuards(makeDb({
        granted: { OPERADOR: ['CONFIGURACION_PRODUCTOS'] },
    }));

    assert.equal((await invoke(guards.requireConfigServiciosPerm, 'OPERADOR')).statusCode, 403);
    assert.equal((await invoke(guards.requireConfigServiciosOProductosPerm, 'OPERADOR')).next, true);
});

test('CONFIGURACION_TARIFAS abre su sección sin un permiso general de menú', async () => {
    const guards = createFaregasConfigPermissionGuards(makeDb({
        granted: { CONTADOR: ['CONFIGURACION_TARIFAS'] },
    }));

    assert.equal((await invoke(guards.requireConfigTarifasPerm, 'CONTADOR')).next, true);
});

test('MENU_CONFIGURACION_SEDES no desbloquea la configuración de empresas', async () => {
    const guards = createFaregasConfigPermissionGuards(makeDb({
        granted: { OPERADOR: ['MENU_CONFIGURACION_SEDES'] },
    }));

    assert.equal((await invoke(guards.requireConfigSedesPerm, 'OPERADOR')).next, true);
    assert.equal((await invoke(guards.requireConfigEmpresasPerm, 'OPERADOR')).statusCode, 403);
});

test('series admite su permiso propio de Facturación y no el permiso contenedor', async () => {
    const fromConfig = createFaregasConfigPermissionGuards(makeDb({
        granted: { A: ['CONFIGURACION_SERIES'] },
    }));
    const fromBilling = createFaregasConfigPermissionGuards(makeDb({
        granted: { B: ['MENU_FACTURACION_SERIES'] },
    }));
    const parentOnly = createFaregasConfigPermissionGuards(makeDb({
        granted: { C: ['MENU_CONFIGURACION'] },
    }));

    assert.equal((await invoke(fromConfig.requireConfigSeriesPerm, 'A')).next, true);
    assert.equal((await invoke(fromBilling.requireConfigSeriesPerm, 'B')).next, true);
    assert.equal((await invoke(parentOnly.requireConfigSeriesPerm, 'C')).statusCode, 403);
});

test('una asignación inactiva no autoriza la API', async () => {
    const guards = createFaregasConfigPermissionGuards(makeDb({
        granted: { OPERADOR: ['CONFIGURACION_PRODUCTOS'] },
        active: [],
    }));

    assert.equal((await invoke(guards.requireConfigProductosPerm, 'OPERADOR')).statusCode, 403);
});

test('un error de PostgreSQL conserva el cierre seguro con 500', async () => {
    const guards = createFaregasConfigPermissionGuards(makeDb({ fail: true }));

    const result = await invoke(guards.requireConfigProductosPerm, 'OPERADOR');
    assert.equal(result.statusCode, 500);
    assert.equal(result.next, false);
});
