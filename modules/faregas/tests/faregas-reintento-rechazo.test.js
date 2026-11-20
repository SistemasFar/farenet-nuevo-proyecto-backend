const test = require('node:test');
const assert = require('node:assert/strict');
const facturacionService = require('../services/faregas-facturacion.service');
const { esFalloTemporalProveedor, esRechazoFiscalDefinitivo } = facturacionService._private;

test('identifica correctamente fallos temporales del proveedor', () => {
    // 1. Límite DEMO 50 docs
    const falloDemo = {
        estado: 'RECHAZADO',
        sunat_description: 'No puedes enviar mas de 50 documentos en en una cuenta DEMO, ingresa a tu cuenta y elimina tus comprobantes.',
        respuesta_proveedor: { codigo: 21, errors: 'No puedes enviar mas de 50 documentos en en una cuenta DEMO' }
    };
    assert.equal(esFalloTemporalProveedor(falloDemo), true);
    assert.equal(esRechazoFiscalDefinitivo(falloDemo), false);

    // 2. Error de red o timeout
    const falloRed = {
        estado: 'RECHAZADO',
        respuesta_proveedor: { status: 'ERROR', reason: 'TIMEOUT' }
    };
    assert.equal(esFalloTemporalProveedor(falloRed), true);
    assert.equal(esRechazoFiscalDefinitivo(falloRed), false);

    // 3. HTTP 503 o 500
    const falloServidor = {
        estado: 'RECHAZADO',
        respuesta_proveedor: { httpStatus: 503 }
    };
    assert.equal(esFalloTemporalProveedor(falloServidor), true);
    assert.equal(esRechazoFiscalDefinitivo(falloServidor), false);
});

test('identifica correctamente rechazos fiscales definitivos de SUNAT', () => {
    const rechazoSunat = {
        estado: 'RECHAZADO',
        aceptada_sunat: false,
        sunat_responsecode: '2033',
        sunat_description: 'El RUC del receptor no está activo en SUNAT.',
        respuesta_proveedor: { codigo: '2033', sunat_responsecode: '2033' }
    };
    assert.equal(esFalloTemporalProveedor(rechazoSunat), false);
    assert.equal(esRechazoFiscalDefinitivo(rechazoSunat), true);
});

test('no considera rechazo definitivo a facturas pendientes o borradores', () => {
    assert.equal(esRechazoFiscalDefinitivo({ estado: 'BORRADOR' }), false);
    assert.equal(esRechazoFiscalDefinitivo({ estado: 'PENDIENTE' }), false);
    assert.equal(esRechazoFiscalDefinitivo({ estado: 'ACEPTADO', aceptada_sunat: true }), false);
});

