const test = require('node:test');
const assert = require('node:assert/strict');
const { createFaregasConfigPermissionGuards } = require('../middlewares/faregas-config-permissions.middleware');
const { tienePermisoFaregas } = require('../services/faregas-autorizacion-permisos.service');

const makeMockDb = (grantsByProfile = {}, users = {}) => ({
    async query(sql, params) {
        if (/FROM public\.fg_usuario/.test(sql)) {
            const username = params[0];
            const perfil_id = users[username] || username;
            return { rows: [{ username, perfil_id, estado: true }], rowCount: 1 };
        }
        const profile = params[0];
        const grants = grantsByProfile[profile] || [];
        const rows = grants.map((permiso_clave) => ({ permiso_clave }));
        return { rows, rowCount: rows.length };
    }
});

const invokeGuard = async (guard, username, perfil = username) => {
    const result = { statusCode: null, body: null, next: false };
    const req = { user: { username, perfil_id: perfil } };
    const res = {
        status(code) { result.statusCode = code; return this; },
        json(body) { result.body = body; return this; },
    };
    await guard(req, res, () => { result.next = true; });
    return result;
};

// ============================================================================
// CASO A — OPERADOR / mcastillo con Configuración deshabilitada
// ============================================================================
test('Caso A: OPERADOR sin permisos de Configuración recibe 403 en todos los endpoints de configuración', async () => {
    const db = makeMockDb({
        OPERADOR: [
            'MENU_INICIO',
            'MENU_DASHBOARD',
            'MENU_CHIPS',
            'MENU_CHIPS_VENTAS',
            'DASHBOARD_GLOBAL',
            'DESCUENTOS_ADMINISTRAR',
            'FAREGAS_SOLICITUD_CREAR',
            'FAREGAS_SOLICITUD_VER'
        ]
    }, { mcastillo: 'OPERADOR' });

    const guards = createFaregasConfigPermissionGuards(db);

    // Endpoints de configuración bloqueados
    const sedesRes = await invokeGuard(guards.requireConfigSedesPerm, 'mcastillo');
    assert.equal(sedesRes.statusCode, 403, 'Sedes debe ser 403');
    assert.equal(sedesRes.next, false);

    const prodsRes = await invokeGuard(guards.requireConfigProductosPerm, 'mcastillo');
    assert.equal(prodsRes.statusCode, 403, 'Productos debe ser 403');
    assert.equal(prodsRes.next, false);

    const servsRes = await invokeGuard(guards.requireConfigServiciosPerm, 'mcastillo');
    assert.equal(servsRes.statusCode, 403, 'Servicios debe ser 403');
    assert.equal(servsRes.next, false);

    const catsRes = await invokeGuard(guards.requireConfigCategoriasPerm, 'mcastillo');
    assert.equal(catsRes.statusCode, 403, 'Categorías debe ser 403');
    assert.equal(catsRes.next, false);

    const tarifasRes = await invokeGuard(guards.requireConfigTarifasPerm, 'mcastillo');
    assert.equal(tarifasRes.statusCode, 403, 'Tarifas debe ser 403');
    assert.equal(tarifasRes.next, false);

    const seriesRes = await invokeGuard(guards.requireConfigSeriesPerm, 'mcastillo');
    assert.equal(seriesRes.statusCode, 403, 'Series debe ser 403');
    assert.equal(seriesRes.next, false);

    const empresasRes = await invokeGuard(guards.requireConfigEmpresasPerm, 'mcastillo');
    assert.equal(empresasRes.statusCode, 403, 'Empresas debe ser 403');
    assert.equal(empresasRes.next, false);

    // Mantiene acceso a Inventario -> Ventas y Dashboard
    const permsEfectivos = [
        'MENU_INICIO', 'MENU_DASHBOARD', 'MENU_CHIPS', 'MENU_CHIPS_VENTAS',
        'DASHBOARD_GLOBAL', 'DESCUENTOS_ADMINISTRAR', 'FAREGAS_SOLICITUD_CREAR', 'FAREGAS_SOLICITUD_VER'
    ];
    assert.equal(tienePermisoFaregas(permsEfectivos, 'MENU_CHIPS_VENTAS'), true);
    assert.equal(tienePermisoFaregas(permsEfectivos, 'CHIPS_VENDER'), true);
    assert.equal(tienePermisoFaregas(permsEfectivos, 'MENU_DASHBOARD'), true);
});

// ============================================================================
// CASO B — Submódulo habilitado: Únicamente Catálogo autorizado
// ============================================================================
test('Caso B: Perfil con únicamente Catálogo autorizado puede usar funciones ordinarias de catálogo sin 403', async () => {
    const db = makeMockDb({
        OPERADOR_CATALOGO: [
            'MENU_CONFIGURACION_CATALOGO'
        ]
    }, { operador_user: 'OPERADOR_CATALOGO' });

    const guards = createFaregasConfigPermissionGuards(db);

    // Funciones ordinarias de Catálogo: PERMITIDAS sin errores 403
    const prodsRes = await invokeGuard(guards.requireConfigProductosPerm, 'operador_user');
    assert.equal(prodsRes.next, true, 'Productos ordinario debe permitir next()');
    assert.equal(prodsRes.statusCode, null);

    const servsRes = await invokeGuard(guards.requireConfigServiciosPerm, 'operador_user');
    assert.equal(servsRes.next, true, 'Servicios ordinario debe permitir next()');
    assert.equal(servsRes.statusCode, null);

    const catsRes = await invokeGuard(guards.requireConfigCategoriasPerm, 'operador_user');
    assert.equal(catsRes.next, true, 'Categorías ordinario debe permitir next()');
    assert.equal(catsRes.statusCode, null);

    const lecturaCatsRes = await invokeGuard(guards.requireLecturaCategoriasPerm, 'operador_user');
    assert.equal(lecturaCatsRes.next, true, 'Lectura de categorías debe permitir next()');

    // Otros submódulos no autorizados: BLOQUEADOS con 403
    const sedesRes = await invokeGuard(guards.requireConfigSedesPerm, 'operador_user');
    assert.equal(sedesRes.statusCode, 403, 'Sedes debe ser 403');

    const tarifasRes = await invokeGuard(guards.requireConfigTarifasPerm, 'operador_user');
    assert.equal(tarifasRes.statusCode, 403, 'Tarifas debe ser 403');

    const seriesRes = await invokeGuard(guards.requireConfigSeriesPerm, 'operador_user');
    assert.equal(seriesRes.statusCode, 403, 'Series debe ser 403');

    const empresasRes = await invokeGuard(guards.requireConfigEmpresasPerm, 'operador_user');
    assert.equal(empresasRes.statusCode, 403, 'Empresas debe ser 403');
});

// ============================================================================
// CASO C — Cambios de permisos: Activación y Revocación
// ============================================================================
test('Caso C: Activación concede acceso y desactivación revoca acceso en backend', async () => {
    const grants = {
        PERFIL_TEST: ['MENU_CONFIGURACION_SEDES']
    };
    const db = {
        async query(sql, params) {
            if (/FROM public\.fg_usuario/.test(sql)) {
                return { rows: [{ username: 'testuser', perfil_id: 'PERFIL_TEST', estado: true }], rowCount: 1 };
            }
            const p = params[0];
            const rows = (grants[p] || []).map((permiso_clave) => ({ permiso_clave }));
            return { rows, rowCount: rows.length };
        }
    };

    const guards = createFaregasConfigPermissionGuards(db);

    // 1. Activo: Sedes permitido
    const r1 = await invokeGuard(guards.requireConfigSedesPerm, 'testuser');
    assert.equal(r1.next, true);

    // 2. Desactivar en BD
    grants.PERFIL_TEST = [];

    // 3. Confirmar que el acceso queda revocado inmediatamente
    const r2 = await invokeGuard(guards.requireConfigSedesPerm, 'testuser');
    assert.equal(r2.statusCode, 403, 'Al desactivar el submódulo, el acceso queda revocado inmediatamente');
    assert.equal(r2.next, false);
});

// ============================================================================
// CASO D — Otros perfiles: CONTADOR, OPERADOR y SISTEMAS sin bypass automático
// ============================================================================
test('Caso D: SISTEMAS y CONTADOR son evaluados estrictamente por permisos efectivos, sin excepciones automáticas por nombre de perfil', async () => {
    // SISTEMAS sin permiso de Empresas desmarcado
    const db = makeMockDb({
        SISTEMAS: [
            'MENU_CONFIGURACION_SEDES',
            'MENU_CONFIGURACION_CATALOGO'
            // NOTA: MENU_CONFIGURACION_EMPRESAS no está presente
        ],
        CONTADOR: [
            'MENU_CONFIGURACION_CORRELATIVOS'
        ]
    }, { admin_sistemas: 'SISTEMAS', contador_user: 'CONTADOR' });

    const guards = createFaregasConfigPermissionGuards(db);

    // SISTEMAS tiene Sedes y Catálogo
    assert.equal((await invokeGuard(guards.requireConfigSedesPerm, 'admin_sistemas')).next, true);
    assert.equal((await invokeGuard(guards.requireConfigProductosPerm, 'admin_sistemas')).next, true);

    // SISTEMAS NO TIENE bypass automático para Empresas si no tiene el permiso
    const sistEmpresas = await invokeGuard(guards.requireConfigEmpresasPerm, 'admin_sistemas');
    assert.equal(sistEmpresas.statusCode, 403, 'SISTEMAS debe recibir 403 si el permiso está desmarcado');

    // CONTADOR solo tiene Series / Correlativos
    assert.equal((await invokeGuard(guards.requireConfigSeriesPerm, 'contador_user')).next, true);
    assert.equal((await invokeGuard(guards.requireConfigSedesPerm, 'contador_user')).statusCode, 403);
    assert.equal((await invokeGuard(guards.requireConfigProductosPerm, 'contador_user')).statusCode, 403);
});

