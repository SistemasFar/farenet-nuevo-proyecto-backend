const test = require('node:test');
const assert = require('node:assert/strict');

const { _private } = require('../services/faregas-productos.service');

test('un producto que requiere chip puede omitir el precio duplicado', () => {
    assert.equal(_private.validarPrecioChip(true, null), null);
});

test('se conserva un precio legacy válido y se rechaza uno inválido', () => {
    assert.equal(_private.validarPrecioChip(true, 123), 123);
    assert.throws(() => _private.validarPrecioChip(true, 0), /CHIP_PRECIO_INVALIDO/);
});

