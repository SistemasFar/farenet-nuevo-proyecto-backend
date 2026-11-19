const test = require('node:test');
const assert = require('node:assert/strict');
const { crearMiddlewarePermisoFaregas } = require('../middlewares/faregas-permisos.middleware');

const makeDb = ({ profiles = {}, grants = {}, active = null, fail = false } = {}) => ({
    queryCount: 0,
    async query(sql, params) {
        this.queryCount += 1;
        if (fail) throw new Error('database unavailable');
        if (/FROM public\.fg_usuario/.test(sql)) {
            const user = profiles[params[0]];
            return { rows: user ? [{ username: params[0], perfil_id: user.profile, estado: user.active !== false }] : [], rowCount: user ? 1 : 0 };
        }
        const list = grants[params[0]] || [];
        const allowed = active ? new Set(active) : new Set(Object.values(grants).flat());
        const rows = list.filter((key) => allowed.has(key)).map((permiso_clave) => ({ permiso_clave }));
        return { rows, rowCount: rows.length };
    }
});

const invoke = async (middleware, username, tokenProfile = 'TOKEN_OBSOLETO') => {
    const result = { statusCode: null, body: null, next: false, req: { user: { username, perfil_id: tokenProfile } } };
    const res = { status(code) { result.statusCode = code; return this; }, json(body) { result.body = body; return this; } };
    await middleware(result.req, res, () => { result.next = true; });
    return result;
};

test('MENU_CHIPS_VENTAS permite listar y registrar ventas sin llaves CHIPS_* duplicadas', async () => {
    const db = makeDb({
        profiles: { mquijano: { profile: 'CONTADOR' } },
        grants: { CONTADOR: ['MENU_CHIPS', 'MENU_CHIPS_VENTAS'] },
    });
    const listar = crearMiddlewarePermisoFaregas(db, { anyOf: ['MENU_CHIPS_VENTAS'] });
    const leer = crearMiddlewarePermisoFaregas(db, { anyOf: ['CHIPS_VER'] });
    const vender = crearMiddlewarePermisoFaregas(db, { anyOf: ['CHIPS_VENDER'] });

    assert.equal((await invoke(listar, 'mquijano')).next, true);
    assert.equal((await invoke(leer, 'mquijano')).next, true);
    assert.equal((await invoke(vender, 'mquijano')).next, true);
});

test('EMISOR autorizado a ventas puede consultar el selector sin permiso de configuración de inventario', async () => {
    const db = makeDb({
        profiles: { emisor: { profile: 'EMISOR' } },
        grants: { EMISOR: ['MENU_CHIPS_VENTAS'] },
    });
    const abrirSelector = crearMiddlewarePermisoFaregas(db, { anyOf: ['MENU_CHIPS_VENTAS'] });
    const lecturaOrdinaria = crearMiddlewarePermisoFaregas(db, { anyOf: ['CHIPS_VER'] });

    assert.equal((await invoke(abrirSelector, 'emisor')).next, true);
    assert.equal((await invoke(lecturaOrdinaria, 'emisor')).next, true);
    assert.equal((await invoke(crearMiddlewarePermisoFaregas(db, { anyOf: ['MENU_CHIPS_TIPOS', 'MENU_CHIPS_INVENTARIO'] }), 'emisor')).statusCode, 403);
});

test('cada submódulo de chips hereda solo las operaciones ordinarias de su sección', async () => {
    const db = makeDb({
        profiles: { inv: { profile: 'OPERADOR' } },
        grants: { OPERADOR: ['MENU_CHIPS_INVENTARIO'] },
    });
    const allow = (permission) => crearMiddlewarePermisoFaregas(db, { anyOf: [permission] });
    for (const permission of ['CHIPS_VER', 'CHIPS_INGRESAR', 'CHIPS_TRANSFERIR', 'CHIPS_BAJA']) {
        assert.equal((await invoke(allow(permission), 'inv')).next, true, permission);
    }
    assert.equal((await invoke(allow('CHIPS_VENDER'), 'inv')).statusCode, 403);
    assert.equal((await invoke(allow('CHIPS_CONFIGURAR'), 'inv')).statusCode, 403);
});

test('una capacidad interna sin el submódulo no permite entrar por URL directa', async () => {
    const db = makeDb({
        profiles: { legacy: { profile: 'OPERADOR' } },
        grants: { OPERADOR: ['CHIPS_VENDER'] },
    });
    const submodulo = crearMiddlewarePermisoFaregas(db, { anyOf: ['MENU_CHIPS_VENTAS'] });
    const operacion = crearMiddlewarePermisoFaregas(db, { allOf: ['MENU_CHIPS_VENTAS', 'CHIPS_VENDER'] });
    assert.equal((await invoke(submodulo, 'legacy')).statusCode, 403);
    assert.equal((await invoke(operacion, 'legacy')).statusCode, 403);
});

test('el submódulo de ventas no hereda el permiso fiscal sensible de anulación', async () => {
    const db = makeDb({
        profiles: { vendedor: { profile: 'CONTADOR' } },
        grants: { CONTADOR: ['MENU_CHIPS_VENTAS'] },
    });
    const anular = crearMiddlewarePermisoFaregas(db, {
        allOf: ['MENU_CHIPS_VENTAS', 'FAREGAS_ANULAR_COMPROBANTE'],
    });
    assert.equal((await invoke(anular, 'vendedor')).statusCode, 403);
});

test('los submódulos de Configuración habilitan las operaciones ordinarias de su sección', async () => {
    const db = makeDb({
        profiles: { catalogo: { profile: 'CONTADOR' }, correlativos: { profile: 'CONTADOR' } },
        grants: {
            CONTADOR: ['MENU_CONFIGURACION_CATALOGO', 'MENU_CONFIGURACION_CORRELATIVOS'],
        },
    });
    const productos = crearMiddlewarePermisoFaregas(db, { anyOf: ['CONFIGURACION_PRODUCTOS'] });
    const categorias = crearMiddlewarePermisoFaregas(db, { anyOf: ['CONFIGURACION_CATEGORIAS'] });
    const series = crearMiddlewarePermisoFaregas(db, { anyOf: ['CONFIGURACION_SERIES'] });
    assert.equal((await invoke(productos, 'catalogo')).next, true);
    assert.equal((await invoke(categorias, 'catalogo')).next, true);
    assert.equal((await invoke(series, 'correlativos')).next, true);
});

test('Sedes no concede administración de Empresas ni un permiso de Facturación', async () => {
    const db = makeDb({
        profiles: { sedes: { profile: 'OPERADOR' }, configSeries: { profile: 'CONTADOR' } },
        grants: {
            OPERADOR: ['MENU_CONFIGURACION_SEDES'],
            CONTADOR: ['CONFIGURACION_SERIES'],
        },
    });
    const empresas = crearMiddlewarePermisoFaregas(db, { anyOf: ['CONFIGURACION_EMPRESAS'] });
    const documentos = crearMiddlewarePermisoFaregas(db, { anyOf: ['MENU_FACTURACION_COMPROBANTES'] });
    const seriesFactura = crearMiddlewarePermisoFaregas(db, { anyOf: ['MENU_FACTURACION_SERIES'] });

    assert.equal((await invoke(empresas, 'sedes')).statusCode, 403);
    assert.equal((await invoke(documentos, 'configSeries')).statusCode, 403);
    assert.equal((await invoke(seriesFactura, 'configSeries')).statusCode, 403);
});

test('resuelve el perfil vigente de PostgreSQL y no el perfil obsoleto del token', async () => {
    const db = makeDb({
        profiles: { user: { profile: 'OPERADOR' } },
        grants: { OPERADOR: ['CONFIGURACION_PRODUCTOS'] },
    });
    const guard = crearMiddlewarePermisoFaregas(db, { anyOf: ['CONFIGURACION_PRODUCTOS'] });
    const result = await invoke(guard, 'user', 'CONTADOR');
    assert.equal(result.next, true);
    assert.equal(result.req.user.perfil_id, 'OPERADOR');
});

test('rechaza usuarios inactivos o inexistentes', async () => {
    const db = makeDb({
        profiles: { inactive: { profile: 'OPERADOR', active: false } },
        grants: { OPERADOR: ['MENU_CHIPS_VENTAS'] },
    });
    const guard = crearMiddlewarePermisoFaregas(db, { anyOf: ['MENU_CHIPS_VENTAS'] });
    assert.equal((await invoke(guard, 'inactive')).statusCode, 403);
    assert.equal((await invoke(guard, 'missing')).statusCode, 401);
});

test('un permiso inactivo y una falla de base siguen cerrando el acceso', async () => {
    const inactivePermissionDb = makeDb({
        profiles: { user: { profile: 'CONTADOR' } }, grants: { CONTADOR: ['MENU_CHIPS_VENTAS'] }, active: [],
    });
    const guard = crearMiddlewarePermisoFaregas(inactivePermissionDb, { anyOf: ['MENU_CHIPS_VENTAS'] });
    assert.equal((await invoke(guard, 'user')).statusCode, 403);

    const failGuard = crearMiddlewarePermisoFaregas(makeDb({ fail: true }), { anyOf: ['MENU_CHIPS_VENTAS'] });
    assert.equal((await invoke(failGuard, 'user')).statusCode, 500);
});

test('varios guards en una solicitud reutilizan el contexto vigente, no duplican lecturas', async () => {
    const db = makeDb({ profiles: { user: { profile: 'CONTADOR' } }, grants: { CONTADOR: ['MENU_CHIPS_VENTAS'] } });
    const submodulo = crearMiddlewarePermisoFaregas(db, { anyOf: ['MENU_CHIPS_VENTAS'] });
    const operar = crearMiddlewarePermisoFaregas(db, { anyOf: ['CHIPS_VENDER'] });
    const req = { user: { username: 'user' } };
    const res = { status() { return this; }, json() {} };
    await submodulo(req, res, () => {});
    await operar(req, res, () => {});
    assert.equal(db.queryCount, 2);
});
