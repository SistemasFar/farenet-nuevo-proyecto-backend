'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    esDocumentoBaseOperable
} = require('../services/faregas-documento-tributario-policy');
const {
    esDocumentoFiscalDeHoy,
    exigirVentanaDiaFiscal
} = require('../services/faregas-fecha-fiscal-dia.service');

const documentoDemo = {
    entorno_facturador: 'DEMO',
    proveedor: 'NUBEFACT',
    estado: 'PENDIENTE_SUNAT',
    nro_comprobante: 'BBB1-00000282',
    serie: 'BBB1',
    numero: 282,
    enlace_pdf: 'pdf',
    enlace_xml: 'xml'
};

test('el día fiscal DATE cambia de anulación a nota en medianoche America/Lima', () => {
    const antesDeMedianoche = new Date('2026-11-07T04:59:59.000Z');
    const medianoche = new Date('2026-11-07T05:00:00.000Z');
    assert.equal(esDocumentoFiscalDeHoy('2026-11-06', antesDeMedianoche), true);
    assert.equal(esDocumentoFiscalDeHoy('2026-11-06', medianoche), false);
    assert.doesNotThrow(() => exigirVentanaDiaFiscal('2026-11-06', 'ANULAR', antesDeMedianoche));
    assert.throws(() => exigirVentanaDiaFiscal('2026-11-06', 'ANULAR', medianoche), { code: 'ANULACION_SOLO_DIA_EMISION' });
    assert.doesNotThrow(() => exigirVentanaDiaFiscal('2026-11-06', 'NOTA_CREDITO', medianoche));
});

test('no inventa fecha y rechaza fechas inválidas o posteriores', () => {
    for (const fecha of [null, '', '06/11/2026', '2026-02-30']) {
        assert.throws(() => exigirVentanaDiaFiscal(fecha, 'NOTA_CREDITO'), { code: 'FECHA_EMISION_FISCAL_NO_DISPONIBLE' });
    }
    assert.throws(() => exigirVentanaDiaFiscal('2026-11-07', 'NOTA_CREDITO', new Date('2026-11-07T05:00:00.000Z')), {
        code: 'NOTA_CREDITO_SOLO_DIA_POSTERIOR'
    });
});

test('conserva la elegibilidad fiscal: DEMO generado sí, pendiente productivo/rechazado/anulado no', () => {
    assert.equal(esDocumentoBaseOperable(documentoDemo), true);
    assert.equal(esDocumentoBaseOperable({ ...documentoDemo, entorno_facturador: 'PRODUCCION' }), false);
    assert.equal(esDocumentoBaseOperable({ ...documentoDemo, estado: 'RECHAZADO' }), false);
    assert.equal(esDocumentoBaseOperable({ ...documentoDemo, estado: 'ANULADO' }), false);
    assert.equal(esDocumentoBaseOperable({ ...documentoDemo, estado: 'ACEPTADO', aceptada_sunat: true }), true);
    assert.equal(esDocumentoBaseOperable({ ...documentoDemo, estado: 'ACEPTADO', aceptada_sunat: false }), false);
});
