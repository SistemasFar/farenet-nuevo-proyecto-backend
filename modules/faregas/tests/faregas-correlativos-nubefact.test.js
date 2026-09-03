const test = require('node:test');
const assert = require('node:assert/strict');
const service = require('../services/faregas-correlativos-nubefact.service');
const db = require('../../../config/database');

test.after(() => db.end());

const serie = {
    id: 8,
    planta_key: '201',
    empresa_key: 'CAMBRIDGE',
    tipo_comprobante: 'BOLETA',
    serie: 'BE02',
    ultimo_numero: 1443,
    autogenerada: true,
    proveedor_emision: 'NUBEFACT',
    entorno_emision: 'PRODUCCION',
    confirmada_produccion: true,
    numero_inicial_confirmado: 1443,
    sistema_origen: 'DMS_FACT',
    fecha_corte: '2026-09-30T23:59:00'
};

test('reserva el siguiente correlativo tributario dentro del executor recibido', async () => {
    const calls = [];
    const executor = {
        async query(sql, params) {
            calls.push({ sql, params });
            if (calls.length === 1) return { rowCount: 1, rows: [serie] };
            return { rowCount: 1, rows: [{ id: 8 }] };
        }
    };
    const result = await service.reservarSiguiente({
        plantaKey: '201', tipoComprobante: 'BOLETA', environment: 'PRODUCCION'
    }, executor);
    assert.equal(result.numero, 1444);
    assert.equal(result.nroComprobante, 'BE02-00001444');
    assert.match(calls[0].sql, /FOR UPDATE OF s/);
    assert.match(calls[0].sql, /proveedor_emision = 'NUBEFACT'/);
    assert.match(calls[0].sql, /entorno_emision = \$3/);
    assert.deepEqual(calls[0].params, ['201', 'BOLETA', 'PRODUCCION']);
    assert.deepEqual(calls[1].params, [1444, 8, 1443]);
});

test('no permite usar en producción una serie no confirmada', async () => {
    const executor = { query: async () => ({ rowCount: 1, rows: [{ ...serie, confirmada_produccion: false }] }) };
    await assert.rejects(
        service.reservarSiguiente({ plantaKey: '201', tipoComprobante: 'BOLETA', environment: 'PRODUCCION' }, executor),
        error => error.code === 'SERIE_PRODUCCION_NO_CONFIRMADA'
    );
});

test('detecta una actualización concurrente y no entrega un número ambiguo', async () => {
    let call = 0;
    const executor = { query: async () => (++call === 1 ? { rowCount: 1, rows: [{ ...serie, entorno_emision: 'DEMO' }] } : { rowCount: 0, rows: [] }) };
    await assert.rejects(
        service.reservarSiguiente({ plantaKey: '201', tipoComprobante: 'BOLETA', environment: 'DEMO' }, executor),
        error => error.code === 'CORRELATIVO_CONCURRENCIA'
    );
});

test('rechaza una serie que no sea exclusiva del ambiente solicitado', () => {
    assert.throws(
        () => service._private.validarSerieOperativa({
            ...service._private.mapSerie(serie),
            entornoEmision: 'DEMO'
        }, 'PRODUCCION'),
        error => error.code === 'SERIE_NUBEFACT_NO_EXCLUSIVA'
    );
});

test('valida el prefijo tributario de notas según su comprobante de referencia', () => {
    assert.equal(service._private.validarSerieTributaria('FC02', 'NOTA_CREDITO_FACTURA'), true);
    assert.equal(service._private.validarSerieTributaria('BC02', 'NOTA_CREDITO_BOLETA'), true);
    assert.equal(service._private.validarSerieTributaria('BC02', 'NOTA_DEBITO_FACTURA'), false);
});
