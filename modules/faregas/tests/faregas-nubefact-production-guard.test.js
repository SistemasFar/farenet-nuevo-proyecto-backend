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
    correlativosV2Enabled: true,
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

test('rechaza un nombre de ambiente ambiguo', () => {
    assert.throws(
        () => validar({ environment: 'PROD' }),
        error => error.code === 'NUBEFACT_ENTORNO_INVALIDO'
    );
});

test('el estado público sólo marca credenciales si su RUC coincide', () => {
    const row = { entorno: 'DEMO', empresa_key: 'CAMBRIDGE', ruc_emisor: '20600444531' };
    assert.equal(configService._private.contextoPublico(row, {
        apiUrl: 'https://api.example.test', token: 'secreto', rucEmisor: '20521536463'
    }).configured, false);
    assert.equal(configService._private.contextoPublico(row, {
        apiUrl: 'https://api.example.test', token: 'secreto', rucEmisor: '20600444531'
    }).configured, true);
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

test('bloquea producción si el motor seguro de correlativos está apagado', () => {
    assert.throws(
        () => validar({ correlativosV2Enabled: false }),
        error => error.code === 'NUBEFACT_CORRELATIVOS_V2_DESHABILITADOS'
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
