/**
 * PANTALLA "Operación y formatos" (Catálogo → Operación y formatos).
 *
 * Qué representa: por cada categoría operativa muestra sus productos fiscales,
 * sus operaciones (`fg_servicio`), si generan certificado, qué formato usan y
 * en qué sedes se ofrecen. La operación NO se crea al crear el producto: se
 * configura aparte con "+ Configurar operación".
 *
 * Dos defectos que estos tests fijan:
 *
 *  1. La pantalla pedía el catálogo con `listar()`, que devuelve una PÁGINA de
 *     10 productos de 271. Toda categoría cuyo producto no cayera en esa página
 *     aparecía con "0 producto(s)"; y, sin producto, `productoPendiente`
 *     quedaba indefinido, así que NO se pintaba el botón "+ Configurar
 *     operación": la operación era imposible de crear desde la pantalla.
 *     Ahora usa `listarPorCategoria()`.
 *
 *  2. Un producto sin operación debe seguir mostrando "1 producto / 0
 *     operaciones": es el estado correcto, no un error que haya que maquillar.
 *
 * Los tests de base son opt-in (FAREGAS_TEST_DB=1) y limpian siempre en
 * `finally`, con borrado en cascada explícito.
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
const configService = require('../services/faregas-config.service');
const productosService = require('../services/faregas-productos.service');
const productosController = require('../controllers/faregas-productos.controller');

const SERVICE = fs.readFileSync(
    path.join(__dirname, '..', 'services', 'faregas-productos.service.js'), 'utf8');
const CONTROLLER = fs.readFileSync(
    path.join(__dirname, '..', 'controllers', 'faregas-productos.controller.js'), 'utf8');
const RUTAS = fs.readFileSync(
    path.join(__dirname, '..', 'routes', 'faregas-config.routes.js'), 'utf8');

const codigo = (t) => t.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
const SIN_BASE = 'requiere FAREGAS_TEST_DB=1 y una base de datos disponible';
const USU = 'gibarra';
const IP = '127.0.0.1';

const conBase = (fn) => (t) => {
    if (!USA_BASE_DE_DATOS) return t.skip(SIN_BASE);
    return fn(t);
};

const pedirListarPorCategoria = () => new Promise((resolve) => {
    const res = {
        _status: 200,
        status(c) { this._status = c; return this; },
        json(cuerpo) { resolve({ status: this._status, cuerpo }); }
    };
    productosController.listarPorCategoria({ user: {}, query: {}, params: {} }, res);
});

/** Reproduce el conteo que la vista hace por cada categoría. */
const resumenDeCategoria = async (categoria) => {
    const categorias = await configService.getCategorias({});
    const servicios = await configService.getServicios();
    const relaciones = await configService.obtenerSedesPorServicio();
    const productos = (await pedirListarPorCategoria()).cuerpo.productos;

    const productosCat = productos.filter((p) => p.categoria_id === categoria.id);
    const serviciosCat = servicios.filter((s) => s.categoria_id === categoria.id);
    const certificaciones = serviciosCat.filter((s) => s.requiere_certificado);
    const sedes = [...new Set(serviciosCat.flatMap(
        (s) => (relaciones[s.id] || []).filter((x) => x.activo).map((x) => x.key)
    ))];
    const serviciosConFormato = serviciosCat.filter((s) => s.formato_id);
    return { productos: productosCat.length, operaciones: serviciosCat.length, generaCertificado: certificaciones.length, conFormato: serviciosConFormato.length, sedes };
};

// ===========================================================================
// 1. Estructura: el endpoint que la pantalla necesita
// ===========================================================================

test('1. existe un listado de productos por categoría', () => {
    assert.match(SERVICE, /exports\.listarPorCategoria = async/);
    assert.match(CONTROLLER, /exports\.listarPorCategoria = async/);
    assert.match(RUTAS, /router\.get\('\/productos\/por-categoria'/);
});

test('2. la ruta por-categoria se registra antes que las que llevan :id', () => {
    const iPorCategoria = RUTAS.indexOf("router.get('/productos/por-categoria'");
    assert.ok(iPorCategoria > -1, 'debe existir la ruta');
    const iId = RUTAS.indexOf("router.put('/productos/:id'");
    if (iId > -1) {
        assert.ok(iPorCategoria < iId, 'la ruta literal debe declararse antes que /productos/:id');
    }
});

test('3. devuelve los productos POR CATEGORÍA, no una página del catálogo', () => {
    const bloque = codigo(SERVICE).slice(
        codigo(SERVICE).indexOf('exports.listarPorCategoria'),
        codigo(SERVICE).indexOf('const validarCategoriaActiva'));
    // Sin LIMIT: el conjunto está acotado por ser sólo los productos con categoría.
    assert.doesNotMatch(bloque, /LIMIT\s+\$/, 'no debe paginar ni usar un pageSize grande');
    assert.doesNotMatch(bloque, /OFFSET/);
    // Y agrupa por la categoría real.
    assert.match(bloque, /JOIN fg_categoria_servicio c ON c\.id = p\.categoria_id/);
    assert.match(bloque, /porCategoria\[fila\.categoria_id\]/);
});

test('4. el listado paginado del catálogo sigue intacto', () => {
    // La corrección no debe tocar el listado con búsqueda de la otra pantalla.
    const bloque = codigo(SERVICE).slice(
        codigo(SERVICE).indexOf('exports.listar = async'),
        codigo(SERVICE).indexOf('exports.listarPorCategoria'));
    assert.match(bloque, /LIMIT \$\$\{valores\.length \+ 1\} OFFSET \$\$\{valores\.length \+ 2\}/);
    assert.match(bloque, /p\.codigo_sku ILIKE/);
});

// ===========================================================================
// 2. El caso real de LUH: producto sin operación
// ===========================================================================

test('5. una categoría con producto y SIN operación muestra 1 producto y 0 operaciones', conBase(async () => {
    const cat = await db.query("SELECT * FROM fg_categoria_servicio WHERE codigo = 'CERTIFICADO_LUH'");
    if (cat.rowCount === 0) return; // el usuario la eliminó

    const r = await resumenDeCategoria(cat.rows[0]);
    // El producto SÍ existe y esta vez se ve: antes salía 0 por la paginación.
    assert.equal(r.productos, 1, 'debe verse el SKU de la categoría');
    // Y 0 operaciones es lo correcto: no existe fila en fg_servicio.
    const enBd = await db.query('SELECT COUNT(*)::int n FROM fg_servicio WHERE categoria_id = $1', [cat.rows[0].id]);
    assert.equal(enBd.rows[0].n, 0, 'precondición: LUH no tiene operaciones');
    assert.equal(r.operaciones, 0, '0 operaciones es el estado correcto');
    assert.equal(r.generaCertificado, 0);
    assert.equal(r.sedes.length, 0);
}));

test('6. el endpoint devuelve el producto de LUH aunque no sea de la página 1', conBase(async () => {
    const cat = await db.query("SELECT id FROM fg_categoria_servicio WHERE codigo = 'CERTIFICADO_LUH'");
    if (cat.rowCount === 0) return;
    const cuerpo = (await pedirListarPorCategoria()).cuerpo;
    const productos = cuerpo.porCategoria[String(cat.rows[0].id)] || [];
    assert.ok(productos.length >= 1, 'el SKU de LUH debe venir en porCategoria');
    assert.ok(productos.every((p) => p.categoria_id === cat.rows[0].id));
    // Y el listado paginado del catálogo, para contraste, se lo pierde.
    const pagina1 = await productosService.listar({ page: 1, pageSize: 10 });
    const enPagina1 = pagina1.items.filter((p) => p.categoria_id === cat.rows[0].id);
    assert.equal(enPagina1.length, 0, 'esto es justo lo que Rompía la pantalla antes');
}));

// ===========================================================================
// 3. El caso completo: producto + operación + certificado + formato + sede
// ===========================================================================

test('8. categoría con operación, certificado, formato y sede se muestra completa', conBase(async () => {
    // Datos reales ya configurados: CONFORMIDAD es el ejemplo que sí funciona.
    const cat = await db.query("SELECT * FROM fg_categoria_servicio WHERE codigo = 'CONFORMIDAD'");
    if (cat.rowCount === 0) return;
    const r = await resumenDeCategoria(cat.rows[0]);
    assert.ok(r.operaciones >= 1, 'CONFORMIDAD debe tener operaciones');
    assert.equal(r.generaCertificado, r.operaciones, 'todas generan certificado en el ejemplo');
    // No todas tienen formato: hay operaciones de prueba sin él. Lo que importa
    // es que las que lo tienen se muestren, y que haya al menos una.
    assert.ok(r.conFormato >= 1, 'debe haber al menos una operación con formato');
    assert.ok(r.conFormato <= r.operaciones);
    assert.ok(r.sedes.length >= 1, 'debe tener al menos una sede activa');
}));

test('9. el flujo completo se construye con categoria, producto, operacion, formato y sede', conBase(async () => {
    // Se monta una categoría temporal con TODAS las relaciones y se comprueba
    // que la pantalla la refleja entera. Todo se borra al final.
    const marca = `TEST_OPFORM_${Date.now()}`;
    let categoriaId;
    let productoId;
    let servicioId;
    let tarifaId;
    try {
        const cat = await db.query(
            `INSERT INTO fg_categoria_servicio (codigo, nombre, descripcion, activo, orden)
             VALUES ($1, $2, null, TRUE, 9990) RETURNING id`, [marca, 'Test Operacion Formatos']);
        categoriaId = cat.rows[0].id;

        const prod = await db.query(
            `INSERT INTO fg_producto_facturacion
                (codigo_sku, descripcion, tipo_producto, categoria_id, cuenta_por_cobrar,
                 unidad, precio_unitario, tipo_afectacion_igv, disponible_pos,
                 es_para_venta, es_para_compra, tiene_icbper, activo)
             VALUES ($1, $2, 'Producto', $3, '222', 'NIU', 100, '10', FALSE,
                     TRUE, FALSE, FALSE, TRUE) RETURNING id`,
            [`SKU_${marca}`, 'Producto de prueba', categoriaId]);
        productoId = prod.rows[0].id;

        const formato = await db.query(
            "SELECT id FROM fg_certificado_formato WHERE activo = TRUE AND codigo = 'CONFORMIDAD' LIMIT 1");
        const formatoId = formato.rows[0].id;

        const creada = await configService.crearServicio({
            codigo: `OP_${marca}`,
            nombre: 'Operacion de prueba',
            categoria_id: categoriaId,
            tipo_flujo: 'CERTIFICACION',
            // Combinación válida según `validarConfiguracionServicio`:
            // tipo CONFORMIDAD exige modalidad nula.
            tipo_certificado_clave: 'CONFORMIDAD',
            modalidad: null,
            requiere_certificado: true,
            requiere_vehiculo: true,
            formato_id: formatoId,
            orden: 1
        }, USU, IP);
        servicioId = creada.id;

        // Sede + precio: es lo que guarda Tarifas y lo que esta pantalla muestra.
        const planta = await db.query("SELECT key FROM fg_planta WHERE activo = TRUE ORDER BY key LIMIT 1");
        const tarifa = await db.query(
            `INSERT INTO fg_tarifa (planta_key, codigo, familia, nombre, tipo_certificado_clave,
                                    modalidad, precio, activo, orden, servicio_id, producto_facturacion_id)
             VALUES ($1, $2, $3, $4, 'CONFORMIDAD', NULL, 100, TRUE, 1, $5, $6) RETURNING id`,
            [planta.rows[0].key, `T_${marca}`, marca, 'Tarifa de prueba', servicioId, productoId]);
        tarifaId = tarifa.rows[0].id;

        const r = await resumenDeCategoria({ id: categoriaId });
        assert.equal(r.productos, 1, '1 producto');
        assert.equal(r.operaciones, 1, '1 operacion');
        assert.equal(r.generaCertificado, 1, '1 genera certificado');
        assert.equal(r.conFormato, 1, 'la operacion tiene formato');
        assert.equal(r.sedes.length, 1, '1 sede');

        // Y el producto queda vinculado a la operacion a traves de la tarifa.
        const relaciones = await configService.obtenerSedesPorServicio();
        const delServicio = relaciones[servicioId] || [];
        assert.equal(delServicio.length, 1);
        // El id puede volver como bigint (string) desde Postgres.
        assert.equal(Number(delServicio[0].producto_facturacion_id), Number(productoId));
        // `obtenerSedesPorServicio` devuelve la sede con la clave `key`.
        assert.equal(delServicio[0].key, planta.rows[0].key);
        assert.equal(delServicio[0].activo, true);
    } finally {
        // Borrado en cascada explícito: la tarifa apunta al servicio y al producto.
        if (tarifaId) await db.query('DELETE FROM fg_tarifa WHERE id = $1', [tarifaId]);
        if (servicioId) await db.query('DELETE FROM fg_servicio WHERE id = $1', [servicioId]);
        if (productoId) await db.query('DELETE FROM fg_producto_facturacion WHERE id = $1', [productoId]);
        if (categoriaId) await db.query('DELETE FROM fg_categoria_servicio WHERE id = $1', [categoriaId]);
    }
}));

test('10. la operación NO se crea sola al crear el producto fiscal', conBase(async () => {
    // Debe seguir siendo así: crear un SKU no inventa una operación.
    const antes = await db.query('SELECT COUNT(*)::int n FROM fg_servicio');
    const cat = await db.query("SELECT id FROM fg_categoria_servicio WHERE codigo = 'CERTIFICADO_LUH'");
    if (cat.rowCount === 0) return;
    await db.query(
        `INSERT INTO fg_producto_facturacion
            (codigo_sku, descripcion, tipo_producto, categoria_id, cuenta_por_cobrar,
             unidad, precio_unitario, tipo_afectacion_igv, disponible_pos,
             es_para_venta, es_para_compra, tiene_icbper, activo)
         VALUES ($1, 'Temporal', 'Producto', $2, '222', 'NIU', 1, '10', FALSE,
                 TRUE, FALSE, FALSE, TRUE)`,
        [`TEMP_${Date.now()}`, cat.rows[0].id]);
    try {
        const despues = await db.query('SELECT COUNT(*)::int n FROM fg_servicio');
        assert.equal(despues.rows[0].n, antes.rows[0].n,
            'crear un producto fiscal no debe crear operaciones por su cuenta');
    } finally {
        await db.query('DELETE FROM fg_producto_facturacion WHERE descripcion = $1 AND codigo_sku LIKE $2',
            ['Temporal', 'TEMP_%']);
    }
}));

test('11. no queda residuo de las pruebas', conBase(async () => {
    const sucios = await db.query(
        "SELECT codigo FROM fg_categoria_servicio WHERE codigo LIKE 'TEST_OPFORM_%'");
    assert.equal(sucios.rowCount, 0, 'no deben quedar categorías de prueba');
    const servicios = await db.query(
        "SELECT codigo FROM fg_servicio WHERE codigo LIKE 'OP_TEST_OPFORM_%'");
    assert.equal(servicios.rowCount, 0, 'no deben quedar operaciones de prueba');
    const tarifas = await db.query("SELECT codigo FROM fg_tarifa WHERE codigo LIKE 'T_TEST_OPFORM_%'");
    assert.equal(tarifas.rowCount, 0, 'no deben quedar tarifas de prueba');
}));
