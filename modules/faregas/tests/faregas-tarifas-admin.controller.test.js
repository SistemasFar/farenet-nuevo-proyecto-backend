const test = require('node:test');
const assert = require('node:assert/strict');
const controller = require('../controllers/faregas-tarifas-admin.controller');
const tarifasService = require('../services/faregas-tarifas-admin.service');
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

const productoValido = {
    activo: true,
    es_para_venta: true,
    unidad: 'ZZ',
    codigo_clasificacion_sunat: '84141607',
    tipo_afectacion_igv: '10'
};

test('acepta un SKU tributario completo para un servicio de certificación', () => {
    assert.doesNotThrow(() => tarifasService._private.validarProducto(productoValido, true));
});

test('acepta un SKU de certificación sin código SUNAT porque es opcional', () => {
    assert.doesNotThrow(() => tarifasService._private.validarProducto({
        ...productoValido,
        codigo_clasificacion_sunat: null
    }, true));
});

test('rechaza desde backend un SKU que no está habilitado para venta', () => {
    assert.throws(
        () => tarifasService._private.validarProducto({ ...productoValido, es_para_venta: false }, true),
        /PRODUCTO_NO_VENTA/
    );
});

test('rechaza desde backend unidad o código SUNAT inválidos en certificación', () => {
    assert.throws(
        () => tarifasService._private.validarProducto({ ...productoValido, unidad: 'NIU' }, true),
        /PRODUCTO_UNIDAD_INVALIDA/
    );
    assert.throws(
        () => tarifasService._private.validarProducto({ ...productoValido, codigo_clasificacion_sunat: '42' }, true),
        /PRODUCTO_CODIGO_SUNAT_INVALIDO/
    );
    assert.throws(
        () => tarifasService._private.validarProducto({ ...productoValido, tipo_afectacion_igv: '20' }, true),
        /PRODUCTO_AFECTACION_IGV_INVALIDA/
    );
});

test('permite otra unidad en productos no vinculados a certificación', () => {
    assert.doesNotThrow(() => tarifasService._private.validarProducto({
        ...productoValido,
        unidad: 'NIU',
        codigo_clasificacion_sunat: null
    }, false));
});
