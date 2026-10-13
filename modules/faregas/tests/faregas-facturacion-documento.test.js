const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
    normalizarFacturacion,
    validarFacturacion,
    validarFacturacionNubefact
} = require('../services/faregas-facturacion.rules');

test('Carné de Extranjería conserva tipo y número alfanumérico al guardar datos de facturación', () => {
    const facturacion = normalizarFacturacion({
        tipoComprobante: 'BOLETA',
        tipoDocumentoCliente: 'CARNETEXTRANJERIA',
        nroDocumento: 'ce123456',
        nombreRazonSocial: 'Cliente extranjero',
        direccion: 'Lima 123',
        email: 'cliente@example.com',
        telefono: '999999999',
        condicionPago: 'CONTADO'
    });

    assert.equal(facturacion.tipoDocumentoCliente, 'CARNETEXTRANJERIA');
    assert.equal(facturacion.nroDocumento, 'CE123456');
    assert.deepEqual(validarFacturacion(facturacion), []);
});

test('Carné de Extranjería no se transforma silenciosamente en DNI para Nubefact', () => {
    const errores = validarFacturacionNubefact({
        tipo_comprobante: 'BOLETA',
        tipo_documento_cliente: 'CARNETEXTRANJERIA',
        nro_documento: 'CE123456',
        nombre_razon_social: 'CLIENTE EXTRANJERO',
        direccion: 'LIMA 123'
    });

    assert.ok(erroresOrDefault(errores).some((error) => error.includes('no tiene un mapeo fiscal habilitado')));
});

test('la migración amplía fg_facturacion sin reescribir el histórico', () => {
    const sql = fs.readFileSync(path.join(
        __dirname,
        '../database/migrations/20261013_faregas_facturacion_tipo_documento.sql'
    ), 'utf8');

    assert.match(sql, /tipo_documento_cliente TYPE VARCHAR\(20\)/i);
    assert.match(sql, /nro_documento TYPE VARCHAR\(20\)/i);
    assert.match(sql, /'CARNETEXTRANJERIA'/);
    assert.doesNotMatch(sql, /\bUPDATE\b/i);
    assert.doesNotMatch(sql, /\bDELETE\b/i);
});

function erroresOrDefault(value) {
    return Array.isArray(value) ? value : [];
}
