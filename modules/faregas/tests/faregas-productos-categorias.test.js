const test = require('node:test');
const assert = require('node:assert/strict');
const controller = require('../controllers/faregas-productos.controller');
const productosService = require('../services/faregas-productos.service');
const db = require('../../../config/database');

test.after(() => db.end());

const response = () => ({
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; }
});

const request = (cambios = {}) => ({
    body: {
        codigo_sku: 'SKU-PRUEBA',
        descripcion: 'Producto de prueba',
        categoria_id: 7,
        unidad: 'ZZ',
        tipo_afectacion_igv: '10',
        es_para_venta: true,
        ...cambios
    },
    user: { username: 'TEST' },
    ip: '127.0.0.1'
});

test('rechaza crear un producto fiscal sin categoría', async () => {
    const res = response();
    await controller.crear(request({ categoria_id: null }), res);
    assert.equal(res.statusCode, 400);
    assert.match(res.payload.message, /categoría es obligatoria/i);
});

test('normaliza y entrega categoria_id al servicio de productos', async () => {
    const original = productosService.crear;
    let recibido = null;
    productosService.crear = async (producto) => {
        recibido = producto;
        return 321;
    };

    try {
        const res = response();
        await controller.crear(request({ categoria_id: '7' }), res);
        assert.equal(res.statusCode, 201);
        assert.equal(res.payload.id, 321);
        assert.equal(recibido.categoria_id, 7);
    } finally {
        productosService.crear = original;
    }
});

test('devuelve conflicto cuando la categoría está inactiva o no existe', async () => {
    const original = productosService.crear;
    productosService.crear = async () => {
        throw new Error('CATEGORIA_NO_DISPONIBLE');
    };

    try {
        const res = response();
        await controller.crear(request(), res);
        assert.equal(res.statusCode, 409);
        assert.match(res.payload.message, /no existe o está inactiva/i);
    } finally {
        productosService.crear = original;
    }
});
