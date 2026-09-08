const test = require('node:test');
const assert = require('node:assert/strict');

const { validarEntornoProduccion } = require('../../../scripts/faregas-cutover');

test('cutover falla cerrado cuando NUBEFACT_ENVIRONMENT no existe', () => {
    assert.equal(validarEntornoProduccion(undefined), false);
    assert.equal(validarEntornoProduccion(''), false);
});

test('cutover solo admite PRODUCCION de forma explicita', () => {
    assert.equal(validarEntornoProduccion('DEMO'), false);
    assert.equal(validarEntornoProduccion('PRODUCTION'), false);
    assert.equal(validarEntornoProduccion('PRODUCCION'), true);
    assert.equal(validarEntornoProduccion(' produccion '), true);
});
