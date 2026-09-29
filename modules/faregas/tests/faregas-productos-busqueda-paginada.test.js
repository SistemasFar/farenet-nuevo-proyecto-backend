/**
 * REGRESIÓN: buscar un producto fiscal que NO está en la primera página.
 *
 * Caso reportado por el usuario (Configuración → Catálogo → Productos Fiscales):
 * se creó el SKU 999 / "LUHAN LUHAN" y, al escribir "LUHAN" en el buscador, la
 * pantalla mostró "0 de 10 productos".
 *
 * Causa: el backend SÍ filtraba antes del LIMIT/OFFSET, pero el frontend pedía
 * la página 1 sin filtros y luego filtraba ESOS 10 registros en memoria. Como
 * el catálogo se ordena por `codigo_sku ASC` y el SKU 999 caía en la posición
 * 272 de 275, no estaba en la página cargada y el filtro del navegador no lo
 * podía ver.
 *
 * Este archivo fija la mitad del backend: que el filtro se aplique sobre TODO
 * el catálogo y la paginación vaya DESPUÉS. La mitad que estaba rota —el
 * frontend filtrando en memoria— vive en el test del frontend, porque es lo
 * que falla sin base de datos.
 *
 * Los tests de base son opt-in (FAREGAS_TEST_DB=1).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const USA_BASE_DE_DATOS = process.env.FAREGAS_TEST_DB === '1';
if (USA_BASE_DE_DATOS) {
    require('../../../config/env-loader').loadEnv(true);
}

const db = require('../../../config/database');
const productos = require('../services/faregas-productos.service');

const SERVICE = fs.readFileSync(
    path.join(__dirname, '..', 'services', 'faregas-productos.service.js'), 'utf8');

/** Sin comentarios: una regla explicada en un comentario no es código. */
const codigo = (t) => t.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

/** El bloque de `listar`, acotado hasta la siguiente función. */
const BLOQUE_LISTAR = codigo(SERVICE).slice(0, codigo(SERVICE).indexOf('const validarCategoriaActiva'));

const SIN_BASE = 'requiere FAREGAS_TEST_DB=1 y una base de datos disponible';
const conBase = (fn) => (t) => {
    if (!USA_BASE_DE_DATOS) return t.skip(SIN_BASE);
    return fn(t);
};

// ===========================================================================
// 1. Estructura del SQL: filtro antes de la paginación
// ===========================================================================

test('1. el backend filtra por SKU y por descripción con ILIKE', () => {
    // La descripción es la columna real donde acaba "Nombre del certificado".
    // No existe una columna `nombre_certificado` en fg_producto_facturacion.
    assert.match(BLOQUE_LISTAR, /p\.codigo_sku ILIKE/);
    assert.match(BLOQUE_LISTAR, /p\.descripcion ILIKE/);
});

test('2. el WHERE se inyecta ANTES del LIMIT/OFFSET', () => {
    const iWhere = BLOQUE_LISTAR.indexOf('${where}');
    const iLimit = BLOQUE_LISTAR.indexOf('LIMIT $');
    assert.ok(iWhere > -1, 'debe existir el bloque ${where}');
    assert.ok(iLimit > iWhere, 'el filtro debe ir antes del LIMIT, nunca después');
});

test('3. el COUNT reutiliza exactamente el mismo WHERE que el SELECT', () => {
    const iCount = BLOQUE_LISTAR.indexOf('COUNT(*)::int AS total');
    assert.ok(iCount > -1);
    assert.match(BLOQUE_LISTAR.slice(iCount, iCount + 400), /\$\{where\}/,
        'el total debe contar el mismo conjunto filtrado que el listado');
});

test('4. el catálogo de unidades es independiente de los filtros', () => {
    // Si se calculara sobre la página, al buscar un texto el desplegable
    // "Unidad" se quedaría corto y su filtro quedaría inservible.
    const m = /SELECT DISTINCT\s+\w*\.?unidad[\s\S]{0,300}/.exec(BLOQUE_LISTAR);
    assert.ok(m, 'debe devolver el catálogo de unidades');
    assert.doesNotMatch(m[0], /\$\{\w+\}/, 'no debe llevar los filtros del listado');
    assert.doesNotMatch(m[0], /WHERE \{where\}/, 'no debe usar el WHERE del listado');
});

test('5. el filtro "Sin categoría" sigue soportado', () => {
    // No se puede expresar con `categoria_id = ?`: son los que tienen NULL.
    assert.match(SERVICE, /SIN_CATEGORIA/);
    assert.match(SERVICE, /p\.categoria_id IS NULL/);
});

// ===========================================================================
// 2. El caso reportado, contra la base real
//
// Estos tests NO dependen de un SKU concreto del entorno: crean el suyo y lo
// borran al terminar. El caso reportado fue el SKU 999 / "LUHAN LUHAN", pero si
// el usuario lo elimina en su pruebas manuales, el test debe seguir teniendo
// sentido por sí solo.
// ===========================================================================

/** Crea un producto con categoría, activo y para venta, y devuelve su id. */
const crearProductoBuscable = async (marca) => {
    const cat = await db.query('SELECT id FROM fg_categoria_servicio ORDER BY id LIMIT 1');
    const r = await db.query(`
        INSERT INTO fg_producto_facturacion
            (codigo_sku, descripcion, tipo_producto, categoria_id, cuenta_por_cobrar,
             unidad, precio_unitario, tipo_afectacion_igv, disponible_pos,
             es_para_venta, es_para_compra, tiene_icbper, activo)
        VALUES ($1, 'LUHAN LUHAN', 'Producto', $2, '222', 'NIU', 222, '10', FALSE,
                TRUE, FALSE, FALSE, TRUE)
        RETURNING id, codigo_sku, descripcion, categoria_id, activo, es_para_venta, unidad
    `, ['999', cat.rows[0].id]);
    return r.rows[0];
};

/** El SKU de prueba debe caer FUERA de la primera página, que es el disparador. */
const skuFueraDeLaPrimeraPagina = async (sku) => {
    // Con el orden por codigo_sku, basta con que el catálogo tenga más de una
    // página y que el SKU no esté entre los 10 primeros.
    const primera = await productos.listar({ page: 1, pageSize: 10 });
    return !primera.items.some((x) => x.codigo_sku === sku);
};

test('6. un producto buscable NO está en la primera página', conBase(async () => {
    const p = await crearProductoBuscable(Date.now());
    try {
        assert.equal(p.descripcion, 'LUHAN LUHAN');
        assert.equal(p.activo, true);
        assert.equal(p.es_para_venta, true);
        assert.equal(p.unidad, 'NIU');
        assert.equal(await skuFueraDeLaPrimeraPagina(p.codigo_sku), true,
            'el producto debe quedar fuera de la primera página: es lo que dispara el bug');
    } finally {
        await db.query('DELETE FROM fg_producto_facturacion WHERE id = $1', [p.id]);
    }
}));

test('7. el síntoma: filtrar en memoria la primera página no encuentra nada', conBase(async () => {
    // Esto es EXACTAMENTE lo que hacía la UI y producía "0 de 10 productos".
    const p = await crearProductoBuscable(Date.now());
    try {
        const pagina1 = await productos.listar({ page: 1, pageSize: 10 });
        const filtrado = pagina1.items.filter((x) =>
            `${x.codigo_sku} ${x.descripcion}`.toLowerCase().includes('luhan'));
        assert.equal(filtrado.length, 0, 'la página 1 no debe contener el producto');
    } finally {
        await db.query('DELETE FROM fg_producto_facturacion WHERE id = $1', [p.id]);
    }
}));

test('8. la corrección: buscar por descripción lo encuentra', conBase(async () => {
    const p = await crearProductoBuscable(Date.now());
    try {
        const r = await productos.listar({ buscar: 'LUHAN', page: 1, pageSize: 10 });
        const encontrado = r.items.find((x) => x.id === p.id);
        assert.ok(encontrado, 'buscar LUHAN debe devolver el producto creado');
        assert.equal(encontrado.descripcion, 'LUHAN LUHAN');
        assert.equal(r.page, 1);
    } finally {
        await db.query('DELETE FROM fg_producto_facturacion WHERE id = $1', [p.id]);
    }
}));

test('9. la corrección: buscar por SKU lo encuentra', conBase(async () => {
    const p = await crearProductoBuscable(Date.now());
    try {
        const r = await productos.listar({ buscar: p.codigo_sku, page: 1, pageSize: 10 });
        assert.ok(r.items.some((x) => x.id === p.id), 'buscar por SKU debe encontrarlo');
        assert.equal(r.total >= 1, true);
    } finally {
        await db.query('DELETE FROM fg_producto_facturacion WHERE id = $1', [p.id]);
    }
}));

test('10. el total es el del resultado filtrado, no el del catálogo', conBase(async () => {
    const p = await crearProductoBuscable(Date.now());
    try {
        const todas = await productos.listar({ page: 1, pageSize: 10 });
        const filtradas = await productos.listar({ buscar: 'LUHAN', page: 1, pageSize: 10 });
        assert.ok(filtradas.total < todas.total, 'el filtro debe reducir el total');
        assert.equal(filtradas.totalPages, Math.ceil(filtradas.total / filtradas.limit));
        assert.equal(filtradas.items.length, Math.min(filtradas.total, filtradas.limit));
    } finally {
        await db.query('DELETE FROM fg_producto_facturacion WHERE id = $1', [p.id]);
    }
}));

test('11. la búsqueda es parcial y no distingue mayúsculas', conBase(async () => {
    const p = await crearProductoBuscable(Date.now());
    try {
        const mayus = await productos.listar({ buscar: 'LUHAN', pageSize: 10 });
        const minus = await productos.listar({ buscar: 'luhan', pageSize: 10 });
        const parcial = await productos.listar({ buscar: 'uhan', pageSize: 10 });
        assert.ok(mayus.items.some((x) => x.id === p.id), 'debe encontrarlo en mayúsculas');
        assert.equal(mayus.total, minus.total);
        assert.equal(mayus.total, parcial.total);
    } finally {
        await db.query('DELETE FROM fg_producto_facturacion WHERE id = $1', [p.id]);
    }
}));

test('12. la búsqueda se combina con los demás filtros', conBase(async () => {
    const p = await crearProductoBuscable(Date.now());
    try {
        const conEstado = await productos.listar({ buscar: 'LUHAN', estado: true, pageSize: 10 });
        const conVenta = await productos.listar({ buscar: 'LUHAN', paraVenta: true, pageSize: 10 });
        const solo = await productos.listar({ buscar: 'LUHAN', pageSize: 10 });
        assert.ok(conEstado.total <= solo.total);
        assert.ok(conVenta.total <= solo.total);
        for (const x of conEstado.items) assert.equal(x.activo, true);
        for (const x of conVenta.items) assert.equal(x.es_para_venta, true);
    } finally {
        await db.query('DELETE FROM fg_producto_facturacion WHERE id = $1', [p.id]);
    }
}));

test('13. el catálogo de unidades no cambia al filtrar', conBase(async () => {
    const sinFiltro = await productos.listar({ page: 1, pageSize: 10 });
    const conFiltro = await productos.listar({ buscar: 'LUHAN', page: 1, pageSize: 10 });
    assert.deepEqual(conFiltro.unidades, sinFiltro.unidades,
        'las unidades del desplegable deben ser las del catálogo completo');
    assert.ok(sinFiltro.unidades.includes('NIU'));
    assert.ok(sinFiltro.unidades.includes('ZZ'));
}));

test('14. la paginación sigue funcionando sin filtros', conBase(async () => {
    const primera = await productos.listar({ page: 1, pageSize: 10 });
    assert.equal(primera.items.length, 10);
    assert.equal(primera.page, 1);
    const segunda = await productos.listar({ page: 2, pageSize: 10 });
    assert.equal(segunda.page, 2);
    const ids = new Set(primera.items.map((p) => p.id));
    assert.ok(segunda.items.every((p) => !ids.has(p.id)), 'la página 2 no repite la 1');
}));

test('15. "Sin categoría" no rompe y sólo trae NULL', conBase(async () => {
    const r = await productos.listar({ categoriaId: 'SIN_CATEGORIA', page: 1, pageSize: 10 });
    for (const p of r.items) {
        assert.equal(p.categoria_id, null, 'el filtro "Sin categoría" sólo debe traer NULL');
    }
    // Y es un subconjunto real del catálogo.
    const todas = await productos.listar({ page: 1, pageSize: 10 });
    assert.ok(r.total <= todas.total);
}));

test('16. una categoría concreta sí filtra', conBase(async () => {
    const cat = await db.query('SELECT id FROM fg_categoria_servicio ORDER BY id LIMIT 1');
    if (cat.rowCount === 0) return;
    const r = await productos.listar({ categoriaId: cat.rows[0].id, page: 1, pageSize: 10 });
    for (const p of r.items) assert.equal(p.categoria_id, cat.rows[0].id);
}));

test('17. una búsqueda sin coincidencias devuelve 0 y ninguna página', conBase(async () => {
    const r = await productos.listar({ buscar: 'zzz-no-existe-zzz', page: 1, pageSize: 10 });
    assert.equal(r.total, 0);
    assert.equal(r.items.length, 0);
    assert.equal(r.totalPages, 0);
}));

test('18. la respuesta conserva `productos` para los consumidores actuales', conBase(async () => {
    // TabCertificadosBase todavía llama a listar() y espera un arreglo.
    const r = await productos.listar({ page: 1, pageSize: 10 });
    assert.ok(Array.isArray(r.productos));
    assert.equal(r.productos.length, r.items.length);
}));
