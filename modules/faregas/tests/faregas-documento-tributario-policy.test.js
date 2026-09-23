const test = require('node:test');
const assert = require('node:assert/strict');
const {
    esAceptadoPorSunat,
    esDemoGeneradoPorNubefact,
    esDocumentoBaseOperable
} = require('../services/faregas-documento-tributario-policy');
const documentosService = require('../services/faregas-documentos-electronicos.service');

const demoGenerado = {
    estado: 'PENDIENTE_SUNAT',
    aceptada_sunat: null,
    entorno_facturador: 'DEMO',
    proveedor: 'NUBEFACT',
    serie: 'BBB1',
    numero: 38,
    nro_comprobante: 'BBB1-00000038',
    enlace_pdf: 'https://demo.test/comprobante.pdf',
    enlace_xml: 'https://demo.test/comprobante.xml'
};

test('producción solo es operable con aceptación SUNAT real', () => {
    assert.equal(esAceptadoPorSunat({ estado: 'ACEPTADO', aceptada_sunat: true }), true);
    assert.equal(esDocumentoBaseOperable({
        ...demoGenerado,
        entorno_facturador: 'PRODUCCION'
    }), false);
    assert.equal(esDocumentoBaseOperable({
        ...demoGenerado,
        entorno_facturador: 'PRODUCCION',
        estado: 'ACEPTADO',
        aceptada_sunat: true
    }), true);
});

test('DEMO generado por NubeFact permite probar nota y anulación', () => {
    assert.equal(esDemoGeneradoPorNubefact(demoGenerado), true);
    assert.equal(esDocumentoBaseOperable(demoGenerado), true);
});

test('DEMO sin identidad o sin artefactos no se considera emitido', () => {
    assert.equal(esDocumentoBaseOperable({ ...demoGenerado, nro_comprobante: null }), false);
    assert.equal(esDocumentoBaseOperable({ ...demoGenerado, enlace_pdf: null, enlace_xml: null }), false);
});

test('una anulación pendiente congela nuevas operaciones tributarias', async () => {
    const executor = {
        query: async () => ({
            rowCount: 1,
            rows: [{ id: 9, estado: 'PENDIENTE' }]
        })
    };
    await assert.rejects(
        documentosService._private.validarSinAnulacionActiva(executor, 229),
        (error) => error.code === 'ANULACION_ACTIVA'
            && error.detalles.anulacionId === 9
            && error.detalles.estado === 'PENDIENTE'
    );
});

test('la anulación de factura usa el primer intento de emisión y vence a las 24 horas', async () => {
    const consultas = [];
    const executor = {
        query: async (sql, params) => {
            consultas.push({ sql, params });
            return { rows: [{ vigente: false }] };
        }
    };
    await assert.rejects(
        documentosService._private.validarPlazoAnulacion(executor, {
            tipo: 'FACTURACION', row: { id: 12 }
        }),
        (error) => error.code === 'PLAZO_ANULACION_VENCIDO' && error.statusCode === 409
    );
    assert.match(consultas[0].sql, /MIN\(fecha_creacion\)/);
    assert.match(consultas[0].sql, /clock_timestamp\(\) < MIN\(fecha_creacion\) \+ INTERVAL '24 hours'/);
    assert.deepEqual(consultas[0].params, [12]);
});

test('una nota emitida dentro del plazo sí se puede anular', async () => {
    const executor = { query: async () => ({ rows: [{ vigente: true }] }) };
    await assert.doesNotReject(
        documentosService._private.validarPlazoAnulacion(executor, {
            tipo: 'CREDITO', tabla: 'fg_credito', row: { id: 31 }
        })
    );
});
