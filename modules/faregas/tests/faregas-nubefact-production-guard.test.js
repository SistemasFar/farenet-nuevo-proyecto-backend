const test = require('node:test');
const assert = require('node:assert/strict');
const configService = require('../services/faregas-nubefact-config.service');
const db = require('../../../config/database');

test.after(() => db.end());

const validar = (overrides = {}) => configService._private.validarSeguridadProduccion({
    environment: 'PRODUCCION',
    productionConfirmed: true,
    enviarSunat: true,
    detractionDecision: 'NO_APLICA',
    ...overrides
});

test('no aplica los seguros productivos en DEMO', () => {
    assert.doesNotThrow(() => validar({
        environment: 'DEMO',
        productionConfirmed: false,
        enviarSunat: false,
        detractionDecision: 'PENDIENTE'
    }));
});

test('bloquea producción sin confirmación explícita', () => {
    assert.throws(
        () => validar({ productionConfirmed: false }),
        error => error.code === 'NUBEFACT_PRODUCCION_NO_CONFIRMADA'
    );
});

test('bloquea producción si el envío automático a SUNAT está apagado', () => {
    assert.throws(
        () => validar({ enviarSunat: false }),
        error => error.code === 'NUBEFACT_ENVIO_SUNAT_DESHABILITADO'
    );
});

test('bloquea producción mientras la detracción no esté confirmada', () => {
    assert.throws(
        () => validar({ detractionDecision: 'PENDIENTE' }),
        error => error.code === 'NUBEFACT_DETRACCION_PENDIENTE_CONFIRMACION'
    );
});

test('bloquea producción si la detracción aplica pero aún no está implementada', () => {
    assert.throws(
        () => validar({ detractionDecision: 'APLICA' }),
        error => error.code === 'NUBEFACT_DETRACCION_CONFIGURACION_PENDIENTE'
    );
});

test('permite completar la validación cuando se confirmó que no aplica detracción', () => {
    assert.doesNotThrow(() => validar());
});
