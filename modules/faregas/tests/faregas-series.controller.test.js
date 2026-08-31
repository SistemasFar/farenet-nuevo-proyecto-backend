const test = require('node:test');
const assert = require('node:assert/strict');
const controller = require('../controllers/faregas-series.controller');
const seriesService = require('../services/faregas-series.service');
const db = require('../../../config/database');

test.after(() => db.end());

const response = () => ({
    statusCode: 200, payload: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; }
});

const request = (overrides = {}) => ({
    body: {
        planta_key: '201', tipo_comprobante: 'FACTURA', serie: 'FE99',
        ultimo_numero: 0, es_predeterminada: false, autogenerada: true,
        contingencia: false, activo: true, ...overrides
    },
    user: { username: 'TEST' }, ip: '127.0.0.1'
});

test('rechaza tipos de comprobante fuera del catálogo Faregas', async () => {
    const res = response();
    await controller.crear(request({ tipo_comprobante: 'GUIA_REMISION' }), res);
    assert.equal(res.statusCode, 400);
    assert.match(res.payload.message, /tipo de comprobante inválido/i);
});

test('rechaza correlativos iniciales negativos', async () => {
    const res = response();
    await controller.crear(request({ ultimo_numero: -1 }), res);
    assert.equal(res.statusCode, 400);
    assert.match(res.payload.message, /mayor o igual a cero/i);
});

test('acepta las notas por tipo de comprobante de referencia como series administrativas Faregas', async () => {
    const crearOriginal = seriesService.crear;
    const recibidos = [];
    seriesService.crear = async (serie) => {
        recibidos.push(serie.tipo_comprobante);
        return recibidos.length;
    };
    try {
        const tiposNota = [
            'NOTA_CREDITO_FACTURA',
            'NOTA_CREDITO_BOLETA',
            'NOTA_DEBITO_FACTURA',
            'NOTA_DEBITO_BOLETA'
        ];
        for (const tipoComprobante of tiposNota) {
            const res = response();
            await controller.crear(request({
                tipo_comprobante: tipoComprobante,
                serie: tipoComprobante.includes('_FACTURA') ? 'FC99' : 'BC99'
            }), res);
            assert.equal(res.statusCode, 201);
        }
        assert.deepEqual(recibidos, tiposNota);
    } finally {
        seriesService.crear = crearOriginal;
    }
});

test('rechaza series que no cumplen los cuatro caracteres y el prefijo F/B', async () => {
    const resPrefijo = response();
    await controller.crear(request({ tipo_comprobante: 'FACTURA', serie: 'BE01' }), resPrefijo);
    assert.equal(resPrefijo.statusCode, 400);
    assert.match(resPrefijo.payload.message, /comenzar con F/i);

    const resLongitud = response();
    await controller.crear(request({ tipo_comprobante: 'BOLETA', serie: 'B0010' }), resLongitud);
    assert.equal(resLongitud.statusCode, 400);
    assert.match(resLongitud.payload.message, /exactamente 4/i);
});
