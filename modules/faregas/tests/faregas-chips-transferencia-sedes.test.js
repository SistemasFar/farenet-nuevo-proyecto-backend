const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';

const chipsService = require('../services/faregas-chips.service');

test('la transferencia de chips sólo acepta COLINA, SURCO y SURQUILLO', () => {
    const { SEDES_TRANSFERENCIA_CHIPS, validarSedeTransferenciaChips } = chipsService._private;
    assert.deepEqual([...SEDES_TRANSFERENCIA_CHIPS], ['13', '98', '160']);
    assert.equal(validarSedeTransferenciaChips(13), '13');
    assert.equal(validarSedeTransferenciaChips('98'), '98');
    assert.equal(validarSedeTransferenciaChips('160'), '160');
});

test('una sede ajena no puede usarse como origen o destino de chips', () => {
    const { validarSedeTransferenciaChips } = chipsService._private;
    assert.throws(
        () => validarSedeTransferenciaChips('201'),
        (error) => error.message === 'SEDE_TRANSFERENCIA_CHIP_NO_PERMITIDA'
            && error.detalles.plantaKey === '201'
    );
});
