const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../../../config/database');
const pagosService = require('../services/faregas-pagos.service');

test.after(() => db.end());

const certificado = {
    id: 10,
    planta_key: '201',
    tarifa_codigo: 'CERT_X_201',
    precio_certificado: '122.00',
    producto_chip_id: '1',
    precio_chip: '30.00'
};

test('snapshot comercial suma certificado y chip sin descuento', async () => {
    const queryable = { query: async () => ({ rowCount: 0, rows: [] }) };
    const resumen = await pagosService._private.obtenerResumenComercial(queryable, certificado);

    assert.deepEqual(resumen, {
        precioCertificado: 122,
        descuentoCertificado: 0,
        certificadoNeto: 122,
        requiereChip: true,
        productoChipId: 1,
        precioChip: 30,
        importeTotal: 152
    });
});

test('descuento comercial reduce solo el certificado y conserva el chip', async () => {
    const queryable = {
        query: async () => ({
            rowCount: 1,
            rows: [{
                importe_original: '122.00',
                importe_descuento: '22.00',
                importe_final: '100.00',
                estado: 'APLICADO',
                codigo: 'PROMO'
            }]
        })
    };
    const resumen = await pagosService._private.obtenerResumenComercial(queryable, certificado);

    assert.equal(resumen.precioCertificado, 122);
    assert.equal(resumen.descuentoCertificado, 22);
    assert.equal(resumen.certificadoNeto, 100);
    assert.equal(resumen.precioChip, 30);
    assert.equal(resumen.importeTotal, 130);
});

test('el histórico usa el precio congelado y no consulta una tarifa futura', async () => {
    let consultas = 0;
    const queryable = {
        async query() {
            consultas += 1;
            return { rowCount: 0, rows: [] };
        }
    };
    const resumen = await pagosService._private.obtenerResumenComercial(queryable, {
        ...certificado,
        precio_certificado: '99.00',
        precio_chip: '15.00'
    });

    assert.equal(consultas, 1);
    assert.equal(resumen.importeTotal, 114);
});

test('producto sin chip conserva el flujo comercial anterior', async () => {
    const queryable = { query: async () => ({ rowCount: 0, rows: [] }) };
    const resumen = await pagosService._private.obtenerResumenComercial(queryable, {
        ...certificado,
        producto_chip_id: null,
        precio_chip: null
    });

    assert.equal(resumen.requiereChip, false);
    assert.equal(resumen.precioChip, 0);
    assert.equal(resumen.importeTotal, 122);
});
