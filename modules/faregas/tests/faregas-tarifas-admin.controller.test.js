const test = require('node:test');
const assert = require('node:assert/strict');
const controller = require('../controllers/faregas-tarifas-admin.controller');
const db = require('../../../config/database');

test.after(() => db.end());

const response = () => ({
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; }
});

const request = (precio) => ({
    body: {
        planta_key: '201', servicio_id: 1, precio,
        producto_facturacion_id: null, activo: true
    },
    user: { username: 'TEST' },
    ip: '127.0.0.1'
});

test('rechaza una tarifa con precio cero antes de acceder a la base de datos', async () => {
    const res = response();
    await controller.crear(request(0), res);
    assert.equal(res.statusCode, 400);
    assert.match(res.payload.message, /mayor que cero/i);
});

test('rechaza una tarifa con precio negativo antes de acceder a la base de datos', async () => {
    const res = response();
    await controller.crear(request(-1), res);
    assert.equal(res.statusCode, 400);
    assert.match(res.payload.message, /mayor que cero/i);
});
