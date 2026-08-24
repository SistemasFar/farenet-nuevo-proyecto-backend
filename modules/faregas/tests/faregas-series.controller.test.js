const test = require('node:test');
const assert = require('node:assert/strict');
const controller = require('../controllers/faregas-series.controller');
const db = require('../../../config/database');

test.after(() => db.end());

const response = () => ({
    statusCode: 200, payload: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; }
});

const request = (overrides = {}) => ({
    body: {
        planta_key: '201', tipo_comprobante: 'FACTURA', serie: 'TEST',
        ultimo_numero: 0, es_predeterminada: false, autogenerada: true,
        contingencia: false, activo: true, ...overrides
    },
    user: { username: 'TEST' }, ip: '127.0.0.1'
});

test('rechaza tipos de comprobante no utilizados por Faregas', async () => {
    const res = response();
    await controller.crear(request({ tipo_comprobante: 'NOTA_CREDITO' }), res);
    assert.equal(res.statusCode, 400);
    assert.match(res.payload.message, /tipo de comprobante inválido/i);
});

test('rechaza correlativos iniciales negativos', async () => {
    const res = response();
    await controller.crear(request({ ultimo_numero: -1 }), res);
    assert.equal(res.statusCode, 400);
    assert.match(res.payload.message, /mayor o igual a cero/i);
});
