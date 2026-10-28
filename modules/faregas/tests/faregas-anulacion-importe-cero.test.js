const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';

const {
    CODIGO_IMPORTE_CERO,
    CODIGO_IMPORTE_NO_DETERMINABLE,
    MENSAJE_IMPORTE_CERO,
    evaluarImporteFinalCertificado,
    exigirAnulacionPermitidaPorImporte,
    esMotivoAnulacionNotaCredito
} = require('../services/faregas-certificado-anulacion-policy.service');

const loggerSilencioso = { error: () => {} };
const TIPOS_CERTIFICADO = ['GLP_INICIAL', 'GLP_ANUAL', 'GNV_INICIAL', 'GNV_ANUAL', 'INSPECCION_TALLER', 'CONFORMIDAD'];

test('El importe final cero bloquea la anulación en todos los tipos de certificado', () => {
    TIPOS_CERTIFICADO.forEach((tipo) => {
        const evaluacion = evaluarImporteFinalCertificado({
            tipo_certificado_clave: tipo,
            facturacion_id: 10,
            facturacion_importe_total: '0.00',
            orden_importe_total: '0.00'
        });
        assert.equal(evaluacion.determinable, true, tipo);
        assert.equal(evaluacion.esCero, true, tipo);
        assert.equal(evaluacion.importeFinal, 0, tipo);
        assert.throws(
            () => exigirAnulacionPermitidaPorImporte(evaluacion, { certificadoId: 10, logger: loggerSilencioso }),
            (error) => error.code === CODIGO_IMPORTE_CERO
                && error.statusCode === 409
                && error.detalles.mensaje === MENSAJE_IMPORTE_CERO
        );
    });
});

test('Un descuento del 100% persistido produce importe final cero', () => {
    const evaluacion = evaluarImporteFinalCertificado({
        tipo_certificado_clave: 'GLP_ANUAL',
        descuento_importe_final: '0.00',
        precio_certificado: '120.00',
        precio_chip: '0.00',
        producto_chip_id: null
    });
    assert.equal(evaluacion.determinable, true);
    assert.equal(evaluacion.esCero, true);
    assert.equal(evaluacion.fuente, 'DESCUENTO_APLICADO');
});

test('Una gratuidad registrada como total de facturación cero bloquea la anulación', () => {
    const evaluacion = evaluarImporteFinalCertificado({
        tipo_certificado_clave: 'CONFORMIDAD',
        facturacion_id: 20,
        facturacion_importe_total: 0,
        precio_certificado: '150.00'
    });
    assert.equal(evaluacion.esCero, true);
    assert.equal(evaluacion.fuente, 'FACTURACION');
});

test('Un precio de lista cero sin descuento también es importe final cero', () => {
    const evaluacion = evaluarImporteFinalCertificado({
        tipo_certificado_clave: 'GNV_ANUAL',
        precio_certificado: '0.00',
        precio_chip: '0.00',
        producto_chip_id: null
    });
    assert.equal(evaluacion.esCero, true);
    assert.equal(evaluacion.fuente, 'PRECIO_CERTIFICADO_SIN_DESCUENTO');
});

test('Un importe final positivo con saldo pendiente no se confunde con cero', () => {
    const evaluacion = evaluarImporteFinalCertificado({
        tipo_certificado_clave: 'INSPECCION_TALLER',
        orden_importe_total: '80.00',
        orden_importe_pagado: '0.00',
        orden_saldo_pendiente: '80.00',
        facturacion_importe_total: '80.00'
    });
    assert.equal(evaluacion.determinable, true);
    assert.equal(evaluacion.esCero, false);
    assert.equal(evaluacion.importeFinal, 80);
    assert.doesNotThrow(() => exigirAnulacionPermitidaPorImporte(evaluacion, { logger: loggerSilencioso }));
});

test('El chip forma parte del importe final y evita asumir cero', () => {
    const evaluacion = evaluarImporteFinalCertificado({
        descuento_importe_final: '0.00',
        precio_certificado: '120.00',
        precio_chip: '15.00',
        producto_chip_id: 99
    });
    assert.equal(evaluacion.determinable, true);
    assert.equal(evaluacion.esCero, false);
    assert.equal(evaluacion.importeFinal, 15);
});

test('La orden de pago prevalece sobre la facturación cuando ambas coinciden', () => {
    const evaluacion = evaluarImporteFinalCertificado({
        orden_importe_total: '90.00',
        facturacion_importe_total: '90.00'
    });
    assert.equal(evaluacion.fuente, 'ORDEN_PAGO');
    assert.equal(evaluacion.importeFinal, 90);
});

test('Una inconsistencia entre orden y facturación no se interpreta como cero', () => {
    const evaluacion = evaluarImporteFinalCertificado({
        orden_importe_total: '0.00',
        facturacion_importe_total: '118.00'
    });
    assert.equal(evaluacion.determinable, false);
    assert.throws(
        () => exigirAnulacionPermitidaPorImporte(evaluacion, { certificadoId: 10, logger: loggerSilencioso }),
        (error) => error.code === CODIGO_IMPORTE_NO_DETERMINABLE
            && error.statusCode === 409
            && error.detalles.motivo === 'IMPORTE_ORDEN_PAGO_INCONSISTENTE_CON_FACTURACION'
    );
});

test('Sin datos persistidos suficientes se bloquea por no determinable, no por cero', () => {
    const evaluacion = evaluarImporteFinalCertificado({ tipo_certificado_clave: 'GLP_INICIAL' });
    assert.equal(evaluacion.determinable, false);
    assert.throws(
        () => exigirAnulacionPermitidaPorImporte(evaluacion, { certificadoId: 10, logger: loggerSilencioso }),
        (error) => error.code === CODIGO_IMPORTE_NO_DETERMINABLE
            && error.statusCode === 409
    );
});

test('Solo los motivos de anulación de nota de crédito quedan sujetos al bloqueo', () => {
    ['01', '1', '02', '2', '06', '6'].forEach((codigo) => {
        assert.equal(esMotivoAnulacionNotaCredito(codigo), true, codigo);
    });
    ['03', '3', '', null].forEach((codigo) => {
        assert.equal(esMotivoAnulacionNotaCredito(codigo), false, String(codigo));
    });
});
