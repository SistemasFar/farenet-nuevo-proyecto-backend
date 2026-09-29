const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const RUTAS = require.resolve('../routes/faregas-chips.routes');
const MIGRACION = path.join(__dirname, '..', 'database', 'migrations', '20260926_faregas_permiso_chips_vender.sql');
const MIGRACION_SUBMODULOS = path.join(__dirname, '..', 'database', 'migrations', '20260929_faregas_permiso_chips_submodulos.sql');

const fuenteRutas = fs.readFileSync(RUTAS, 'utf8');
const lineas = fuenteRutas.split('\n').map((linea) => linea.trim());

/** Extrae (metodo, ruta, permisos) de cada declaración de ruta. */
// Los grupos de rutas se expresan con un helper por submódulo que encadena dos
// middlewares: el submódulo de navegación (MENU_CHIPS_*) y el permiso operativo
// (CHIPS_*). Aquí se resuelven los dos para poder comprobar cada uno por separado.
const SUBMODULOS = {
    inventario: 'MENU_CHIPS_INVENTARIO',
    tipos: 'MENU_CHIPS_TIPOS',
    ventas: 'MENU_CHIPS_VENTAS'
};

/** Devuelve los middlewares de permiso declarados en una linea de ruta. */
const middlewaresDe = (linea) => {
    const encontrados = [];
    for (const m of linea.matchAll(/\.\.\.(\w+)\(([^)]*)\)|permiso\(([^)]*)\)/g)) {
        const helper = m[1];
        const args = (m[2] ?? m[3] ?? '').split(',')
            .map((p) => p.trim().replace(/^'|'$/g, ''))
            .filter(Boolean);
        encontrados.push({ helper, args, esSubmodulo: Boolean(helper && SUBMODULOS[helper]) });
    }
    return encontrados;
};

const obtenerRutas = () => lineas
    .filter((linea) => /^router\.(get|post|put|patch|delete)\(/.test(linea))
    .map((linea) => {
        const metodo = linea.match(/^router\.(get|post|put|patch|delete)\(/)[1].toUpperCase();
        const ruta = linea.match(/router\.\w+\('([^']+)'/)[1];
        const middlewares = middlewaresDe(linea);
        const permisos = middlewares.flatMap((m) => m.args);
        const submodulos = middlewares
            .filter((m) => m.esSubmodulo)
            .map((m) => SUBMODULOS[m.helper]);
        return { metodo, ruta, permisos, submodulos, linea };
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
    // Sin permiso SIEMPRE es 403: un 200 dejaría pasar la petición.
    assert.match(fuenteRutas, /if\(!r\.rowCount\)return res\.status\(403\)\.json\(\{success:false,message:'No tiene permiso para esta operaci[oó]n de chips\.'\}\);/,
        'sin permiso responde 403');
    assert.doesNotMatch(fuenteRutas, /if\(!r\.rowCount\)return res\.status\(200\)/, 'nunca 200 sin permiso');
    assert.doesNotMatch(fuenteRutas, /requirePermission|if\s*\(\s*perfil/, 'sin bypass de autorización');
    assert.doesNotMatch(fuenteRutas, /next\(\)\s*;\s*return|return next\(\)/, 'no se salta el permiso');
    assert.match(fuenteRutas, /authFaregasMiddleware/, 'la autenticación sigue activa');
    assert.doesNotMatch(fuenteRutas, /TMUÑOZ|TMUNOZ/i, 'no hay usernames hardcodeados');
});

test('1c. los helpers de submódulo encadenan el permiso operativo', () => {
    // Si un helper devolviera sólo el submódulo, el permiso operativo
    // desaparecería silenciosamente: con el submódulo en la mano, cualquier
    // perfil podría, por ejemplo, crear tipos de chip.
    for (const [helper, submodulo] of Object.entries(SUBMODULOS)) {
        const definicion = new RegExp(
            `const ${helper} = \\(\\.\\.\\.operativo\\) => \\[permiso\\('${submodulo}'\\), permiso\\(\\.\\.\\.operativo\\)\\];`
        );
        assert.match(fuenteRutas, definicion, `${helper} debe pedir el submódulo Y el operativo`);
    }
});

test('1d. el middleware de autenticación sigue montado en el router', () => {
    // Que el import siga presente no basta: tiene que aplicarse al router.
    assert.match(fuenteRutas, /router\.use\(authFaregasMiddleware\);/);
    assert.match(fuenteRutas, /const \{ authFaregasMiddleware \} = require\('\.\.\/middlewares\/faregas-auth\.middleware'\);/);
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
    for (const ruta of ['/ventas', '/ventas/:operacionId']) {
        assert.deepEqual(permisoDe('GET', ruta).permisos, ['CHIPS_VER'], `GET ${ruta}`);
    }
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

const TODOS_LOS_SUBMODULOS = ['MENU_CHIPS_INVENTARIO', 'MENU_CHIPS_TIPOS', 'MENU_CHIPS_VENTAS'];

const PERMISOS = {
    OPERADOR: ['MENU_CHIPS', 'MENU_INICIO', 'CHIPS_VER', 'CHIPS_VENDER', ...TODOS_LOS_SUBMODULOS],
    SISTEMAS: ['CHIPS_VER', 'CHIPS_VENDER', 'CHIPS_CONFIGURAR', 'CHIPS_INGRESAR', 'CHIPS_TRANSFERIR',
        'CHIPS_BAJA', 'MENU_CHIPS', ...TODOS_LOS_SUBMODULOS],
    JEFE_PLANTA: ['MENU_CHIPS', 'MENU_INICIO', ...TODOS_LOS_SUBMODULOS],
    SIN_PERMISOS: []
};

/**
 * Replica los DOS middlewares encadenados: primero el submódulo de navegación
 * y después el permiso operativo. Los dos tienen que pasar.
 */
const puede = (perfil, metodo, ruta) => {
    const permisos = PERMISOS[perfil] || [];
    const r = permisoDe(metodo, ruta);
    return permitido(permisos, r.submodulos) && permitido(permisos, r.permisos);
};

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
    const soloLectura = ['CHIPS_VER', 'MENU_CHIPS_VENTAS'];
    assert.equal(permitido(soloLectura, permisoDe('GET', '/ventas').permisos), true);
    assert.equal(permitido(soloLectura, permisoDe('POST', '/ventas').permisos), false);
});

test('3f. SISTEMAS conserva el acceso completo', () => {
    for (const [metodo, ruta] of [['GET', '/ventas'], ['GET', '/ventas/:operacionId'], ['POST', '/ventas'], ['POST', '/venta-directa'], ['POST', '/productos']]) {
        assert.equal(puede('SISTEMAS', metodo, ruta), true, `SISTEMAS perdió ${metodo} ${ruta}`);
    }
});

test('3g. JEFE_PLANTA navega el módulo pero no opera', () => {
    // Conserva el acceso de navegación, pero sin permisos operativos no
    // consulta ni escribe nada.
    assert.equal(puede('JEFE_PLANTA', 'GET', '/ventas'), false);
    assert.equal(puede('JEFE_PLANTA', 'POST', '/ventas'), false);
    assert.equal(puede('JEFE_PLANTA', 'GET', '/productos'), false);
    assert.equal(puede('JEFE_PLANTA', 'GET', '/'), false);
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
// 3-bis. Submódulos: navegación y capacidad son dos cosas distintas
// ===========================================================================

test('6. cada grupo de endpoints exige SU submódulo de navegación', () => {
    const esperado = {
        'GET /': 'MENU_CHIPS_INVENTARIO',
        'GET /resumen': 'MENU_CHIPS_INVENTARIO',
        'GET /:id/movimientos': 'MENU_CHIPS_INVENTARIO',
        'POST /ingresos': 'MENU_CHIPS_INVENTARIO',
        'POST /transferencias': 'MENU_CHIPS_INVENTARIO',
        'POST /bajas': 'MENU_CHIPS_INVENTARIO',
        'GET /productos': 'MENU_CHIPS_TIPOS',
        'GET /productos/catalogos': 'MENU_CHIPS_TIPOS',
        'POST /productos': 'MENU_CHIPS_TIPOS',
        'PUT /productos/:id': 'MENU_CHIPS_TIPOS',
        'DELETE /productos/:id': 'MENU_CHIPS_TIPOS',
        'GET /productos/:id/impacto': 'MENU_CHIPS_TIPOS',
        'GET /ventas': 'MENU_CHIPS_VENTAS',
        'GET /ventas/:operacionId': 'MENU_CHIPS_VENTAS',
        'POST /ventas': 'MENU_CHIPS_VENTAS',
        'POST /venta-directa': 'MENU_CHIPS_VENTAS',
        'POST /venta-directa/validar': 'MENU_CHIPS_VENTAS',
        'POST /reservas': 'MENU_CHIPS_VENTAS',
        'POST /liberaciones': 'MENU_CHIPS_VENTAS'
    };
    for (const [firma, submodulo] of Object.entries(esperado)) {
        const [metodo, ruta] = firma.split(' ');
        const r = permisoDe(metodo, ruta);
        assert.deepEqual(r.submodulos, [submodulo], `${firma} debería exigir ${submodulo}`);
        // Y sigue exigiendo además su permiso operativo.
        assert.ok(r.permisos.length > 0, `${firma} perdió su permiso operativo`);
    }
});

test('6b. los dos middlewares se encadenan: submódulo Y operación', () => {
    // Un permiso de navegación sin el operativo no abre el endpoint.
    const soloNavegacion = [...TODOS_LOS_SUBMODULOS];
    assert.equal(permitido(soloNavegacion, permisoDe('GET', '/ventas').submodulos), true);
    assert.equal(permitido(soloNavegacion, permisoDe('GET', '/ventas').permisos), false);
    // Y al revés: el operativo sin el submódulo tampoco.
    const soloOperativo = ['CHIPS_VER', 'CHIPS_VENDER'];
    assert.equal(permitido(soloOperativo, permisoDe('GET', '/ventas').permisos), true);
    assert.equal(permitido(soloOperativo, permisoDe('GET', '/ventas').submodulos), false);
});

test('6c. las rutas compartidas con otros módulos no se estrechan', () => {
    // Estas dos las usa además Configuración / NuevoCertificado: se conservan
    // tal cual para no afectar esos flujos.
    assert.deepEqual(permisoDe('GET', '/disponibilidad/:numeroChip').submodulos, []);
    assert.deepEqual(permisoDe('GET', '/disponibilidad/:numeroChip').permisos, []);
    const fiscales = permisoDe('GET', '/catalogo-fiscales');
    assert.deepEqual(fiscales.submodulos, []);
    assert.ok(fiscales.permisos.includes('MENU_CONFIGURACION'));
    assert.ok(fiscales.permisos.includes('CONFIGURACION_PRODUCTOS'));
});

test('7. la migración da los tres submódulos a quien ya tenía MENU_CHIPS', () => {
    const sql = fs.readFileSync(MIGRACION_SUBMODULOS, 'utf8');
    // Cada submódulo se registra en el CATÁLOGO con su nombre legible: es lo
    // que muestra "Editar Perfil". Se comprueba clave y nombre en la misma
    // tupla del INSERT, no por separado.
    for (const [clave, nombre] of [
        ['MENU_CHIPS_INVENTARIO', 'Inventario de chips'],
        ['MENU_CHIPS_TIPOS', 'Tipos de chip'],
        ['MENU_CHIPS_VENTAS', 'Ventas de chips']
    ]) {
        assert.match(sql, new RegExp(`\\(\\s*'${clave}',\\s*'${nombre}',\\s*'MENU'`),
            `registra ${clave} con el nombre "${nombre}"`);
    }
    assert.match(sql, /ON CONFLICT \(clave\) DO UPDATE/, 'idempotente en fg_permiso');
    assert.match(sql, /ON CONFLICT DO NOTHING/, 'idempotente en fg_perfil_permiso');
    assert.match(sql, /BEGIN;[\s\S]*COMMIT;/, 'va dentro de una transacción');
    // La condición que decide quién recibe los submódulos.
    assert.match(sql, /WHERE pp\.permiso_clave IN \('MENU_CHIPS', 'CHIPS_VER'\)/,
        'se basa en quien ya podía ver Chips');
    assert.doesNotMatch(sql, /fg_usuario|username\s*=/i, 'no asigna por usuario');
});

test('7b. los submódulos NO reemplazan a los permisos CHIPS_* operativos', () => {
    const sql = fs.readFileSync(MIGRACION_SUBMODULOS, 'utf8');

    // Lo único que la migración OTORGA son las tres claves de submódulo: es la
    // lista VALUES que se cruza con los perfiles, no el WHERE (que sólo dice
    // QUIÉN los recibe).
    const valores = /CROSS JOIN \(\s*([\s\S]*?)\s*\)\s*AS sub\(clave\)/.exec(sql);
    assert.ok(valores, 'no se encontró la lista de submódulos otorgados');
    const otorgados = [...valores[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    assert.deepEqual(otorgados.sort(), ['MENU_CHIPS_INVENTARIO', 'MENU_CHIPS_TIPOS', 'MENU_CHIPS_VENTAS'],
        'sólo se otorgan los tres submódulos, nada más');

    // No retira nada: si hiciera un DELETE, algún perfil perdería acceso.
    assert.doesNotMatch(sql, /DELETE\s+FROM/i, 'no borra permisos de ningún perfil');
    assert.doesNotMatch(sql, /UPDATE\s+fg_perfil_permiso/i, 'no reescribe permisos');

    // CHIPS_VER aparece sólo como CRITERIO de quién recibe los submódulos.
    const comoCriterio = [...sql.matchAll(/permiso_clave IN \(([^)]*)\)/g)]
        .flatMap((m) => [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]));
    assert.deepEqual(comoCriterio.sort(), ['CHIPS_VER', 'MENU_CHIPS'],
        'el criterio es quien ya podía ver Chips');

    // No inventa claves con formato de capacidad operativa.
    assert.doesNotMatch(sql, /'(CHIPS_INVENTARIO|CHIPS_TIPOS|CHIPS_VENTAS)'/,
        'no duplica la autoridad de los CHIPS_*');
});

test('7c. MENU_CHIPS por sí solo ya no abre los endpoints', () => {
    // Éste era el problema reportado: el permiso general habilitaba todo.
    const soloMenu = ['MENU_CHIPS'];
    for (const [metodo, ruta] of [['GET', '/'], ['GET', '/resumen'], ['GET', '/productos'],
        ['GET', '/ventas'], ['POST', '/venta-directa'], ['POST', '/productos']]) {
        assert.equal(permitido(soloMenu, permisoDe(metodo, ruta).submodulos), false,
            `MENU_CHIPS no debe abrir ${metodo} ${ruta}`);
    }
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
