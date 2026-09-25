const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const RUTAS = require.resolve('../routes/faregas-chips.routes');
const MIGRACION = path.join(__dirname, '..', 'database', 'migrations', '20260926_faregas_permiso_chips_vender.sql');

const fuenteRutas = fs.readFileSync(RUTAS, 'utf8');
const lineas = fuenteRutas.split('\n').map((linea) => linea.trim());

/** Extrae (metodo, ruta, permisos) de cada declaración de ruta. */
const obtenerRutas = () => lineas
    .filter((linea) => /^router\.(get|post|put|patch|delete)\(/.test(linea))
    .map((linea) => {
        const metodo = linea.match(/^router\.(get|post|put|patch|delete)\(/)[1].toUpperCase();
        const ruta = linea.match(/router\.\w+\('([^']+)'/)[1];
        const bloque = linea.match(/permiso\(([^)]*)\)/);
        const permisos = bloque
            ? bloque[1].split(',').map((p) => p.trim().replace(/^'|'$/g, '')).filter(Boolean)
            : [];
        return { metodo, ruta, permisos, linea };
    });

const RUTAS_CHIPS = obtenerRutas();
const permisoDe = (metodo, ruta) => {
    const encontrada = RUTAS_CHIPS.find((r) => r.metodo === metodo && r.ruta === ruta);
    assert.ok(encontrada, `no se encontró la ruta ${metodo} ${ruta}`);
    return encontrada;
};

const MENSAJE_ERROR = 'No tiene permiso para esta operación de chips.';

// ===========================================================================
// 1. El middleware de permisos sigue siendo la autoridad
// ===========================================================================

test('1. el middleware de permisos no fue eliminado ni falseado', () => {
    assert.match(fuenteRutas, /const permiso = \(\.\.\.claves\) =>/, 'el helper permiso() sigue existiendo');
    assert.match(fuenteRutas, /SELECT 1 FROM fg_perfil_permiso WHERE perfil_clave=\$1 AND permiso_clave=ANY\(\$2::varchar\[\]\)/,
        'sigue consultando fg_perfil_permiso con el perfil del usuario');
    assert.match(fuenteRutas, new RegExp(MENSAJE_ERROR.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
        'conserva el mensaje de 403 original');
    assert.doesNotMatch(fuenteRutas, /requirePermission|if\s*\(\s*perfil/, 'sin bypass de autorización');
    assert.doesNotMatch(fuenteRutas, /next\(\)\s*;\s*return|return next\(\)/, 'no se salta el permiso');
    assert.match(fuenteRutas, /authFaregasMiddleware/, 'la autenticación sigue activa');
    assert.doesNotMatch(fuenteRutas, /TMUÑOZ|TMUNOZ/i, 'no hay usernames hardcodeados');
});

test('1b. ninguna ruta de escritura quedó sin permiso', () => {
    const escrituras = RUTAS_CHIPS.filter((r) => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(r.metodo));
    assert.ok(escrituras.length >= 8);
    for (const ruta of escrituras) {
        assert.ok(ruta.permisos.length > 0, `ruta sin permiso: ${ruta.metodo} ${ruta.ruta}`);
    }
});

// ===========================================================================
// 2. Lectura y escritura usan permisos distintos
// ===========================================================================

test('2. listar ventas y ver detalle exigen CHIPS_VER (lectura)', () => {
    assert.deepEqual(permisoDe('GET', '/ventas').permisos, ['CHIPS_VER']);
    assert.deepEqual(permisoDe('GET', '/ventas/:operacionId').permisos, ['CHIPS_VER']);
});

test('2b. vender, validar, reservar y liberar exigen CHIPS_VENDER (escritura)', () => {
    for (const ruta of ['/ventas', '/venta-directa', '/venta-directa/validar', '/reservas', '/liberaciones']) {
        assert.deepEqual(permisoDe('POST', ruta).permisos, ['CHIPS_VENDER'], `POST ${ruta}`);
    }
});

test('2c. consultar ventas NO exige el permiso de escritura', () => {
    const listado = permisoDe('GET', '/ventas');
    const detalle = permisoDe('GET', '/ventas/:operacionId');
    assert.ok(!listado.permisos.includes('CHIPS_VENDER'), 'listar no debe exigir vender');
    assert.ok(!detalle.permisos.includes('CHIPS_VENDER'), 'ver detalle no debe exigir vender');
});

test('2d. los permisos administrativos no se tocan', () => {
    assert.deepEqual(permisoDe('POST', '/productos').permisos, ['CHIPS_CONFIGURAR']);
    assert.deepEqual(permisoDe('PUT', '/productos/:id').permisos, ['CHIPS_CONFIGURAR']);
    assert.deepEqual(permisoDe('DELETE', '/productos/:id').permisos, ['CHIPS_CONFIGURAR']);
    assert.deepEqual(permisoDe('POST', '/ingresos').permisos, ['CHIPS_INGRESAR']);
    assert.deepEqual(permisoDe('POST', '/transferencias').permisos, ['CHIPS_TRANSFERIR']);
    assert.deepEqual(permisoDe('POST', '/bajas').permisos, ['CHIPS_BAJA']);
});

// ===========================================================================
// 3. Simulación del middleware por perfil
// ===========================================================================

/** Replica la consulta del middleware contra un conjunto de permisos. */
const permitido = (permisosDelPerfil, exigidos) => exigidos.some((clave) => permisosDelPerfil.includes(clave));

const PERMISOS = {
    OPERADOR: ['MENU_CHIPS', 'MENU_INICIO', 'CHIPS_VER', 'CHIPS_VENDER'],
    SISTEMAS: ['CHIPS_VER', 'CHIPS_VENDER', 'CHIPS_CONFIGURAR', 'CHIPS_INGRESAR', 'CHIPS_TRANSFERIR', 'CHIPS_BAJA', 'MENU_CHIPS'],
    JEFE_PLANTA: ['MENU_CHIPS', 'MENU_INICIO'],
    SIN_PERMISOS: []
};

const puede = (perfil, metodo, ruta) => permitido(PERMISOS[perfil] || [], permisoDe(metodo, ruta).permisos);

test('3. OPERADOR puede listar ventas', () => {
    assert.equal(puede('OPERADOR', 'GET', '/ventas'), true);
});

test('3b. OPERADOR puede ver el detalle de una venta', () => {
    assert.equal(puede('OPERADOR', 'GET', '/ventas/:operacionId'), true);
});

test('3c. OPERADOR puede vender chips (validar, vender y venta directa)', () => {
    assert.equal(puede('OPERADOR', 'POST', '/ventas'), true);
    assert.equal(puede('OPERADOR', 'POST', '/venta-directa/validar'), true);
    assert.equal(puede('OPERADOR', 'POST', '/venta-directa'), true);
    assert.equal(puede('OPERADOR', 'POST', '/reservas'), true);
    assert.equal(puede('OPERADOR', 'POST', '/liberaciones'), true);
});

test('3d. un perfil SIN permiso sigue recibiendo 403 al vender', () => {
    assert.equal(puede('SIN_PERMISOS', 'POST', '/ventas'), false);
    assert.equal(puede('SIN_PERMISOS', 'GET', '/ventas'), false);
    // Un perfil con sólo lectura NO puede escribir.
    assert.equal(permisoDe('POST', '/ventas').permisos.includes('CHIPS_VER'), false,
        'vender no debe depender de CHIPS_VER');
});

test('3e. un perfil con sólo CHIPS_VER puede consultar pero no vender', () => {
    const soloLectura = ['CHIPS_VER'];
    assert.equal(permitido(soloLectura, permisoDe('GET', '/ventas').permisos), true);
    assert.equal(permitido(soloLectura, permisoDe('POST', '/ventas').permisos), false);
});

test('3f. SISTEMAS conserva el acceso completo', () => {
    for (const [metodo, ruta] of [['GET', '/ventas'], ['GET', '/ventas/:operacionId'], ['POST', '/ventas'], ['POST', '/venta-directa'], ['POST', '/productos']]) {
        assert.equal(puede('SISTEMAS', metodo, ruta), true, `SISTEMAS perdió ${metodo} ${ruta}`);
    }
});

test('3g. JEFE_PLANTA no cambia: sigue sin venta ni lectura de ventas', () => {
    assert.equal(puede('JEFE_PLANTA', 'GET', '/ventas'), false);
    assert.equal(puede('JEFE_PLANTA', 'POST', '/ventas'), false);
    assert.equal(puede('JEFE_PLANTA', 'GET', '/productos'), true, 'conserva MENU_CHIPS para inventario');
});

// NOTA: PERMISOS es una simulación local del middleware, NO lee la base. Este
// test describe el set RESTRINGIDO que tendrá OPERADOR cuando se definan las
// reglas reales por perfil. Durante la fase de desarrollo actual los perfiles
// están temporalmente igualados a SISTEMAS (ver
// 20260927_faregas_permisos_temporales_iguales.sql), así que la base sí
// entrega esos permisos a OPERADOR. Lo que este test sigue comprobando es el
// mapeo ruta -> permiso: escribir en productos inventariables exige
// CHIPS_CONFIGURAR, sea cual sea el perfil.
test('3h. con un set restringido, las rutas administrativas siguen exigiendo su permiso', () => {
    for (const clave of ['CHIPS_CONFIGURAR', 'CHIPS_INGRESAR', 'CHIPS_TRANSFERIR', 'CHIPS_BAJA',
        'MENU_CONFIGURACION', 'CONFIGURACION_PRODUCTOS', 'CONFIGURACION_TARIFAS', 'DESCUENTOS_ADMINISTRAR']) {
        assert.equal(PERMISOS.OPERADOR.includes(clave), false, `OPERADOR no debe tener ${clave}`);
    }
    assert.equal(puede('OPERADOR', 'POST', '/productos'), false);
    assert.equal(puede('OPERADOR', 'PUT', '/productos/:id'), false);
    assert.equal(puede('OPERADOR', 'DELETE', '/productos/:id'), false);
});

// ===========================================================================
// 4. El seed es idempotente y de perfil, no de usuario
// ===========================================================================

test('4. la migración crea el permiso real CHIPS_VENDER', () => {
    const sql = fs.readFileSync(MIGRACION, 'utf8');
    assert.match(sql, /INSERT INTO fg_permiso/, 'registra el permiso en el catálogo');
    assert.match(sql, /'CHIPS_VENDER'/, 'con el código real CHIPS_VENDER');
    assert.match(sql, /ON CONFLICT \(clave\) DO UPDATE/, 'idempotente en fg_permiso');
    assert.match(sql, /ON CONFLICT DO NOTHING/, 'idempotente en fg_perfil_permiso');
    assert.match(sql, /BEGIN;[\s\S]*COMMIT;/, 'va dentro de una transacción');
});

test('4b. asigna el permiso al PERFIL OPERADOR, no a un usuario', () => {
    const sql = fs.readFileSync(MIGRACION, 'utf8');
    assert.match(sql, /\(\s*'OPERADOR'\s*,\s*'CHIPS_VER'\s*\)/, 'OPERADOR recibe lectura');
    assert.match(sql, /\(\s*'OPERADOR'\s*,\s*'CHIPS_VENDER'\s*\)/, 'OPERADOR recibe venta');
    assert.doesNotMatch(sql, /fg_usuario|username\s*=/i, 'no asigna por usuario');
});

test('4c. SISTEMAS recibe CHIPS_VENDER para no perder el acceso', () => {
    const sql = fs.readFileSync(MIGRACION, 'utf8');
    assert.match(sql, /SELECT DISTINCT pp\.perfil_clave, 'CHIPS_VENDER'[\s\S]*WHERE pp\.permiso_clave = 'CHIPS_VER'/,
        'los perfiles que ya leían chips conservan la venta');
});

test('4d. la migración no otorga permisos administrativos', () => {
    const sql = fs.readFileSync(MIGRACION, 'utf8');
    for (const clave of ['CHIPS_CONFIGURAR', 'MENU_CONFIGURACION', 'CONFIGURACION_PRODUCTOS', 'CONFIGURACION_TARIFAS']) {
        assert.doesNotMatch(sql, new RegExp(`'${clave}'`), `no debe asignar ${clave}`);
    }
});

// ===========================================================================
// 5. El frontend refleja el permiso, no lo decide
// ===========================================================================

test('5. el botón + Vender Chips depende de CHIPS_VENDER', () => {
    const vista = fs.readFileSync(
        path.join(__dirname, '..', '..', '..', '..', 'farenetFrontend', 'src', 'modules', 'faregas', 'views', 'Chips', 'ChipsView.tsx'),
        'utf8'
    );
    assert.match(vista, /permisos\.includes\('CHIPS_VENDER'\)/, 'lee el permiso real del perfil');
    assert.match(vista, /\{puedeVender && \(/, 'el botón se oculta sin el permiso');
    assert.match(vista, /\+ Vender Chips/, 'sigue existiendo el botón');
    assert.doesNotMatch(vista, /'OPERADOR'/, 'no hardcodea el perfil OPERADOR');
    assert.doesNotMatch(vista, /TMUÑOZ|TMUNOZ/i, 'no hardcodea usuarios');
});
