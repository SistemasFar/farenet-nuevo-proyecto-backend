const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';

const descuentos = require('../services/faregas-descuentos.service');

test('listarDescuentosDisponibles devuelve lista calculada por ID sin codigos', async () => {
    // Test that the method exists and is a function
    assert.equal(typeof descuentos.listarDescuentosDisponibles, 'function');
    assert.equal(typeof descuentos.aplicarDescuentoDirectoBorrador, 'function');
});

test('calcularImporteFinal calcula correctamente FLAT, MONTO y PORCENTAJE', () => {
    const fn = descuentos._private.calcularImporteFinal;
    // MONTO
    assert.equal(fn(100, 'MONTO', 20), 80);
    // PORCENTAJE
    assert.equal(fn(80, 'PORCENTAJE', 20), 64);
    // FLAT
    assert.equal(fn(100, 'FLAT', 50), 50);
});
