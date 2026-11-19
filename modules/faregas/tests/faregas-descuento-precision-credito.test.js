'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluarReglaPrecio, normalizarValorRegla } = require('../services/faregas-descuentos-reglas');
const {
    normalizarFacturacion,
    validarFacturacion,
    validarCuotasContraTotal
} = require('../services/faregas-facturacion.rules');

test('descuentos MONTO conservan los centavos desde el valor ingresado', () => {
    const casos = [
        ['20', 20, 70],
        ['20.5', 20.5, 69.5],
        ['20.50', 20.5, 69.5],
        ['20.75', 20.75, 69.25],
    ];
    for (const [ingresado, descuentoEsperado, finalEsperado] of casos) {
        const calculo = evaluarReglaPrecio('MONTO', ingresado, '90.00');
        assert.equal(calculo.valido, true, ingresado);
        assert.equal(calculo.importeDescuento, descuentoEsperado, ingresado);
        assert.equal(calculo.importeFinal, finalEsperado, ingresado);
    }
    assert.equal(normalizarValorRegla('20.50'), '20.50');
});

test('rechaza precisión adicional y porcentaje redondea sobre centavos enteros', () => {
    assert.equal(evaluarReglaPrecio('MONTO', '20.555', '90.00').valido, false);
    assert.equal(normalizarValorRegla(20.000000001), null);
    assert.equal(evaluarReglaPrecio('PORCENTAJE', '12.50', '90.00').importeDescuento, 11.25);
    assert.equal(evaluarReglaPrecio('PORCENTAJE', '12.50', '90.00').importeFinal, 78.75);
});

const crearFacturaCredito = (cuotas) => normalizarFacturacion({
    tipoComprobante: 'FACTURA',
    tipoDocumentoCliente: 'RUC',
    nroDocumento: '20600695771',
    nombreRazonSocial: 'CLIENTE DE PRUEBA',
    condicionPago: 'CREDITO',
    fechaInicioCredito: '2026-11-18',
    fechaVencimiento: '2027-02-18',
    cuotas,
});

test('backend acepta planes de una a tres cuotas que suman S/ 70.00', () => {
    const planes = [
        [{ numeroCuota: 1, fechaPago: '2026-12-18', importe: '70.00' }],
        [
            { numeroCuota: 1, fechaPago: '2026-12-18', importe: '35.00' },
            { numeroCuota: 2, fechaPago: '2027-02-18', importe: '35.00' },
        ],
        [
            { numeroCuota: 1, fechaPago: '2026-12-18', importe: '23.33' },
            { numeroCuota: 2, fechaPago: '2027-01-18', importe: '23.33' },
            { numeroCuota: 3, fechaPago: '2027-02-18', importe: '23.34' },
        ],
    ];
    for (const cuotas of planes) {
        const factura = crearFacturaCredito(cuotas);
        assert.deepEqual(validarFacturacion(factura), []);
        assert.equal(validarCuotasContraTotal(factura.cuotas, 70), true);
    }
});

test('backend rechaza más de tres cuotas e importes con más de dos decimales', () => {
    const cuatroCuotas = [1, 2, 3, 4].map(numeroCuota => ({
        numeroCuota,
        fechaPago: `2026-12-${String(10 + numeroCuota).padStart(2, '0')}`,
        importe: '17.50',
    }));
    assert.ok(validarFacturacion(crearFacturaCredito(cuatroCuotas)).some(error => error.includes('maximo 3')));

    const importeImpreciso = crearFacturaCredito([
        { numeroCuota: 1, fechaPago: '2026-12-18', importe: '70.005' },
    ]);
    assert.ok(validarFacturacion(importeImpreciso).some(error => error.includes('maximo dos decimales')));
});
