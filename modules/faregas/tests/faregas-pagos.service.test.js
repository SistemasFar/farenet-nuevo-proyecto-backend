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
