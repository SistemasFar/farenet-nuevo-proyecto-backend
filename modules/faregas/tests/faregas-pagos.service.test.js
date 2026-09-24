const test = require('node:test');
const assert = require('node:assert/strict');
const reglas = require('../services/faregas-pagos.rules');

test('agrupa pagos en efectivo como lo hace Farenet', () => {
    const pagos = reglas.normalizarPagos([
        { tipo: 'EFECTIVO', importe: '40.10' },
        { tipo: 'efectivo', importe: 9.90 },
        { tipo: 'TARJETA', importe: 100, tarjetaKey: '3', nroOperacion: 'ABC' },
    ]);
    assert.equal(pagos.length, 2);
    assert.deepEqual(pagos[0], { tipo: 'efectivo', importe: 50 });
    assert.equal(pagos[1].tipo, 'tarjeta');
});

test('rechaza medios e importes inválidos antes de escribir en base de datos', () => {
    assert.throws(() => reglas.normalizarPagos([{ tipo: 'CHEQUE', importe: 10 }]), /TIPO_PAGO_INVALIDO/);
    assert.throws(() => reglas.normalizarPagos([{ tipo: 'EFECTIVO', importe: 0 }]), /IMPORTE_PAGO_INVALIDO/);
});

test('calcula importes monetarios con dos decimales', () => {
    assert.equal(reglas.redondear(150 / 1.18), 127.12);
    assert.equal(reglas.redondear(150 - reglas.redondear(150 / 1.18)), 22.88);
});

test('el detalle comercial conserva el SKU y la unidad fiscal del producto', () => {
    const snapshot = reglas.construirSnapshotProducto({
        producto_facturacion_id: 192,
        producto_sku: '0221',
        producto_descripcion: 'CERTIFICACION ANUAL DE GLP',
        producto_unidad: 'niu',
        producto_afectacion_igv: '10',
        producto_codigo_sunat: null,
        servicio_codigo: 'GLP_ANUAL',
        servicio_nombre: 'Certificado Anual'
    }, { tipo_certificado_clave: 'GLP_ANUAL' });

    assert.deepEqual(snapshot, {
        productoFacturacionId: 192,
        codigoSku: '0221',
        descripcion: 'CERTIFICACION ANUAL DE GLP',
        unidad: 'NIU',
        afectacionIgv: '10',
        codigoSunat: null
    });
});

test('acepta código SUNAT vacío o válido y rechaza un valor informado inválido', () => {
    for (const codigo of [null, '', '12345678']) {
        assert.equal(reglas.esCodigoClasificacionSunatValidoOpcional(codigo), true);
    }
    for (const codigo of ['1234567', '123456789', 'ABCDEFGH']) {
        assert.equal(reglas.esCodigoClasificacionSunatValidoOpcional(codigo), false);
    }
});

test('rechaza un producto fiscal de chip sin afectación IGV', () => {
    assert.equal(reglas.esProductoFiscalChipValido({
        activo: true,
        es_para_venta: true,
        codigo_sku: 'TEST_CHIP',
        descripcion: 'CHIP DE PRUEBA',
        unidad: 'NIU',
        tipo_afectacion_igv: null,
        codigo_clasificacion_sunat: null
    }), false);
});

test('acepta un producto fiscal completo para facturar el chip', () => {
    assert.equal(reglas.esProductoFiscalChipValido({
        activo: true,
        es_para_venta: true,
        codigo_sku: 'CHIP-001',
        descripcion: 'CHIP Y PORTA CHIP',
        unidad: 'NIU',
        tipo_afectacion_igv: '10',
        codigo_clasificacion_sunat: null
    }), true);
});
