const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const db = require('../../../config/database');
const productosController = require('../controllers/faregas-productos.controller');
const productosService = require('../services/faregas-productos.service');

test.after(async () => {
    await db.end();
});

const leer = (...partes) => fs.readFileSync(path.join(__dirname, ...partes), 'utf8');

const invocar = (handler, body, params = {}) => new Promise((resolve) => {
    const res = {
        statusCode: 200,
        status(code) { this.statusCode = code; return this; },
        json(payload) { resolve({ status: this.statusCode, payload }); }
    };
    handler({ body, params, user: { username: 'TEST' }, ip: '127.0.0.1' }, res);
});

const productoDms = {
    codigo_sku: 'DMS-001',
    descripcion: 'PRODUCTO DMS',
    tipo_producto: 'Producto',
    categoria_id: 7,
    cuenta_por_cobrar: '7041101',
    codigo_barras: '775000000001',
    unidad: 'NIU',
    precio_unitario: 76.27,
    precio_referencia: 90,
    valor_referencial_unitario: 90,
    codigo_clasificacion_sunat: '42',
    tipo_afectacion_igv: '10',
    codigo_afectacion_isc: '01',
    porcentaje_isc: 0,
    disponible_pos: true,
    es_para_venta: true,
    es_para_compra: true,
    tiene_icbper: false,
    imagen_url: 'https://example.test/producto.png',
    activo: false,
    requiere_chip: false
};

test('Nuevo y Editar Producto conservan todos los campos del maestro DMS', async () => {
    const originales = { crear: productosService.crear, editar: productosService.editar };
    let creado;
    let editado;
    productosService.crear = async (producto) => { creado = producto; return 999; };
    productosService.editar = async (id, producto) => { editado = { id, producto }; };
    try {
        const alta = await invocar(productosController.crear, productoDms);
        assert.equal(alta.status, 201);
        assert.equal(creado.codigo_barras, productoDms.codigo_barras);
        assert.equal(creado.precio_referencia, 90, 'precio_referencia representa el precio de venta unitario existente');
        assert.equal(creado.codigo_afectacion_isc, '01');
        assert.equal(creado.imagen_url, productoDms.imagen_url);
        assert.equal(creado.activo, false);

        const edicion = await invocar(productosController.editar, {
            ...productoDms,
            codigo_barras: null,
            codigo_afectacion_isc: null,
            imagen_url: null,
            activo: true
        }, { id: '999' });
        assert.equal(edicion.status, 200);
        assert.equal(editado.id, 999);
        assert.equal(editado.producto.codigo_barras, null);
        assert.equal(editado.producto.codigo_afectacion_isc, null);
        assert.equal(editado.producto.imagen_url, null);
        assert.equal(editado.producto.activo, true);
    } finally {
        productosService.crear = originales.crear;
        productosService.editar = originales.editar;
    }
});

test('la migración sólo agrega los tres campos realmente faltantes y acepta históricos NULL', () => {
    const migracion = leer('..', 'database', 'migrations', '20260930_faregas_producto_maestro_dms.sql');
    assert.match(migracion, /ADD COLUMN IF NOT EXISTS codigo_barras/);
    assert.match(migracion, /ADD COLUMN IF NOT EXISTS codigo_afectacion_isc/);
    assert.match(migracion, /ADD COLUMN IF NOT EXISTS imagen_url/);
    assert.doesNotMatch(migracion, /ADD COLUMN IF NOT EXISTS (precio_venta_unitario|sede_id|categoria_dms)/);
    assert.doesNotMatch(migracion, /NOT NULL/);
    assert.doesNotMatch(migracion, /DROP|DELETE|TRUNCATE/i);
});

test('el servicio lee y guarda los campos DMS sin crear relaciones de sede u operaciones', () => {
    const fuente = leer('..', 'services', 'faregas-productos.service.js');
    for (const campo of ['codigo_barras', 'codigo_afectacion_isc', 'imagen_url']) {
        assert.match(fuente, new RegExp(`p\\.${campo}`));
        assert.match(fuente, new RegExp(`producto\\.${campo}`));
    }
    assert.doesNotMatch(fuente.slice(fuente.indexOf('exports.crear = async'), fuente.indexOf('exports.editar = async')), /INSERT INTO fg_(tarifa|servicio|certificado_formato)/);
    assert.doesNotMatch(fuente, /sede_id\s*=/);
});

test('CHIP y porta chip conserva un único producto fiscal y una única relación de tipo', {
    skip: process.env.FAREGAS_TEST_DB === '1' ? false : 'requiere FAREGAS_TEST_DB=1'
}, async () => {
    const resultado = await db.query(`
        SELECT pi.id AS tipo_chip_id,
               pi.codigo AS tipo_chip_codigo,
               pi.activo AS tipo_chip_activo,
               pi.control_stock,
               COUNT(DISTINCT COALESCE(pis.producto_facturacion_id, pi.producto_facturacion_id))::int AS productos_fiscales,
               BOOL_AND(pf.activo) AS producto_activo,
               BOOL_AND(pf.es_para_venta) AS para_venta,
               BOOL_AND(pf.unidad IS NOT NULL AND pf.tipo_afectacion_igv IS NOT NULL) AS fiscal_valido
        FROM fg_producto_inventariable pi
        LEFT JOIN fg_producto_inventariable_sede pis
          ON pis.producto_inventariable_id = pi.id AND pis.activo = TRUE
        JOIN fg_producto_facturacion pf
          ON pf.id = COALESCE(pis.producto_facturacion_id, pi.producto_facturacion_id)
        WHERE pi.codigo = 'CHIP' AND pi.tipo = 'CHIP_SERIALIZADO'
        GROUP BY pi.id, pi.codigo, pi.activo, pi.control_stock
    `);
    assert.equal(resultado.rowCount, 1);
    assert.equal(resultado.rows[0].productos_fiscales, 1);
    assert.equal(resultado.rows[0].tipo_chip_activo, true);
    assert.equal(resultado.rows[0].control_stock, true);
    assert.equal(resultado.rows[0].producto_activo, true);
    assert.equal(resultado.rows[0].para_venta, true);
    assert.equal(resultado.rows[0].fiscal_valido, true);
});

test('crear y editar persisten el maestro DMS completo sin dejar residuos', {
    skip: process.env.FAREGAS_TEST_DB === '1' ? false : 'requiere FAREGAS_TEST_DB=1'
}, async () => {
    const sku = `TEST_DMS_${Date.now()}`;
    let id = null;
    try {
        const categoria = await db.query(
            'SELECT id FROM fg_categoria_servicio WHERE activo = TRUE ORDER BY id LIMIT 1'
        );
        assert.equal(categoria.rowCount, 1);
        id = await productosService.crear({
            ...productoDms,
            codigo_sku: sku,
            categoria_id: categoria.rows[0].id
        }, 'gibarra', '127.0.0.1');

        await productosService.editar(id, {
            ...productoDms,
            categoria_id: categoria.rows[0].id,
            codigo_barras: '775000000002',
            codigo_afectacion_isc: '02',
            imagen_url: null,
            precio_referencia: 95,
            activo: true
        }, 'gibarra', '127.0.0.1');

        const guardado = await db.query(`
            SELECT codigo_barras, codigo_afectacion_isc, imagen_url,
                   precio_unitario, precio_referencia,
                   valor_referencial_unitario, disponible_pos,
                   es_para_venta, es_para_compra, tiene_icbper, activo
            FROM fg_producto_facturacion WHERE id = $1
        `, [id]);
        assert.equal(guardado.rowCount, 1);
        assert.equal(guardado.rows[0].codigo_barras, '775000000002');
        assert.equal(guardado.rows[0].codigo_afectacion_isc, '02');
        assert.equal(guardado.rows[0].imagen_url, null);
        assert.equal(Number(guardado.rows[0].precio_unitario), 76.27);
        assert.equal(Number(guardado.rows[0].precio_referencia), 95);
        assert.equal(Number(guardado.rows[0].valor_referencial_unitario), 90);
        assert.equal(guardado.rows[0].disponible_pos, true);
        assert.equal(guardado.rows[0].es_para_venta, true);
        assert.equal(guardado.rows[0].es_para_compra, true);
        assert.equal(guardado.rows[0].tiene_icbper, false);
        assert.equal(guardado.rows[0].activo, true);
    } finally {
        if (id) await db.query('DELETE FROM fg_producto_facturacion WHERE id = $1', [id]);
        await db.query(
            "DELETE FROM fg_auditoria_config WHERE entidad = 'PRODUCTO_FACTURACION' AND identificador = $1 AND username = 'gibarra'",
            [sku]
        );
    }
});

