const test = require('node:test');
const assert = require('node:assert');
const { validateEnvironment } = require('../../../config/environment-validator');

test('Validador de Ambientes', async (t) => {
    let originalEnv = { ...process.env };

    t.beforeEach(() => {
        process.env = { ...originalEnv };
    });

    await t.test('DEMO + DB_NAME=farenet_demo pasa', () => {
        process.env.APP_DATABASE_ENVIRONMENT = 'DEMO';
        process.env.NUBEFACT_ENVIRONMENT = 'DEMO';
        process.env.NUBEFACT_ALLOW_GLOBAL_FALLBACK = 'false';
        process.env.NUBEFACT_ALLOW_LEGACY_CREDENTIAL_KEYS = 'false';
        process.env.NUBEFACT_SIMULATION_ENABLED = 'false';
        process.env.NUBEFACT_ENABLED = 'true';
        process.env.NUBEFACT_ENVIAR_SUNAT = 'true';
        
        process.env.DB_USER = 'user';
        process.env.DB_HOST = 'host';
        process.env.DB_NAME = 'farenet_demo';
        process.env.DB_PASSWORD = 'pass';
        process.env.DB_PORT = '5432';
        process.env.PORT = '3000';

        assert.doesNotThrow(() => validateEnvironment());
    });

    await t.test('DEMO + DB_NAME=inspeccion falla', () => {
        process.env.APP_DATABASE_ENVIRONMENT = 'DEMO';
        process.env.NUBEFACT_ENVIRONMENT = 'DEMO';
        process.env.DB_NAME = 'inspeccion';
        assert.throws(() => validateEnvironment(), /DB_NAME apunta a la base de producción/);
    });

    await t.test('DEMO + DB_NAME vacío falla', () => {
        process.env.APP_DATABASE_ENVIRONMENT = 'DEMO';
        process.env.NUBEFACT_ENVIRONMENT = 'DEMO';
        process.env.DB_NAME = '';
        assert.throws(() => validateEnvironment(), /DB_NAME no es 'farenet_demo'/);
    });

    await t.test('APP_DATABASE_ENVIRONMENT=DESARROLLO + NUBEFACT_ENVIRONMENT=DEMO => PERMITIDO', () => {
        process.env.APP_DATABASE_ENVIRONMENT = 'DESARROLLO';
        process.env.NUBEFACT_ENVIRONMENT = 'DEMO';
        process.env.NUBEFACT_ALLOW_GLOBAL_FALLBACK = 'false';
        process.env.NUBEFACT_ALLOW_LEGACY_CREDENTIAL_KEYS = 'false';
        process.env.NUBEFACT_SIMULATION_ENABLED = 'false';
        process.env.NUBEFACT_ENABLED = 'true';
        process.env.NUBEFACT_ENVIAR_SUNAT = 'true';
        process.env.DB_USER = 'user';
        process.env.DB_HOST = 'host';
        process.env.DB_NAME = 'inspeccion';
        process.env.DB_PASSWORD = 'pass';
        process.env.DB_PORT = '5432';
        process.env.PORT = '3000';
        assert.doesNotThrow(() => validateEnvironment());
    });

    await t.test('APP_DATABASE_ENVIRONMENT=DEMO + NUBEFACT_ENVIRONMENT=DEMO => PERMITIDO', () => {
        process.env.APP_DATABASE_ENVIRONMENT = 'DEMO';
        process.env.NUBEFACT_ENVIRONMENT = 'DEMO';
        process.env.NUBEFACT_ALLOW_GLOBAL_FALLBACK = 'false';
        process.env.NUBEFACT_ALLOW_LEGACY_CREDENTIAL_KEYS = 'false';
        process.env.NUBEFACT_SIMULATION_ENABLED = 'false';
        process.env.NUBEFACT_ENABLED = 'true';
        process.env.NUBEFACT_ENVIAR_SUNAT = 'true';
        process.env.DB_USER = 'user';
        process.env.DB_HOST = 'host';
        process.env.DB_NAME = 'farenet_demo';
        process.env.DB_PASSWORD = 'pass';
        process.env.DB_PORT = '5432';
        process.env.PORT = '3000';
        assert.doesNotThrow(() => validateEnvironment());
    });

    await t.test('APP_DATABASE_ENVIRONMENT=PRODUCCION + NUBEFACT_ENVIRONMENT=DEMO => PROHIBIDO', () => {
        process.env.APP_DATABASE_ENVIRONMENT = 'PRODUCCION';
        process.env.NUBEFACT_ENVIRONMENT = 'DEMO';
        assert.throws(() => validateEnvironment(), /Combinación de ambientes no permitida/);
    });

    await t.test('APP_DATABASE_ENVIRONMENT=DESARROLLO + NUBEFACT_ENVIRONMENT=PRODUCCION => PROHIBIDO', () => {
        process.env.APP_DATABASE_ENVIRONMENT = 'DESARROLLO';
        process.env.NUBEFACT_ENVIRONMENT = 'PRODUCCION';
        assert.throws(() => validateEnvironment(), /Combinación de ambientes no permitida/);
    });

    await t.test('APP_DATABASE_ENVIRONMENT=DEMO + NUBEFACT_ENVIRONMENT=PRODUCCION => PROHIBIDO', () => {
        process.env.APP_DATABASE_ENVIRONMENT = 'DEMO';
        process.env.NUBEFACT_ENVIRONMENT = 'PRODUCCION';
        process.env.DB_NAME = 'farenet_demo';
        assert.throws(() => validateEnvironment(), /Combinación de ambientes no permitida/);
    });

    await t.test('APP_DATABASE_ENVIRONMENT=PRODUCCION + NUBEFACT_ENVIRONMENT=PRODUCCION => PERMITIDO', () => {
        process.env.APP_DATABASE_ENVIRONMENT = 'PRODUCCION';
        process.env.NUBEFACT_ENVIRONMENT = 'PRODUCCION';
        assert.doesNotThrow(() => validateEnvironment());
    });

    await t.test('APP_DATABASE_ENVIRONMENT=DEMO y NUBEFACT vacío falla', () => {
        process.env.APP_DATABASE_ENVIRONMENT = 'DEMO';
        process.env.NUBEFACT_ENVIRONMENT = '';
        process.env.DB_NAME = 'farenet_demo';
        assert.throws(() => validateEnvironment(), /APP_DATABASE_ENVIRONMENT es DEMO pero NUBEFACT_ENVIRONMENT está vacío/);
    });

    await t.test('NUBEFACT_ENVIRONMENT=DEMO y APP_DATABASE_ENVIRONMENT vacío falla', () => {
        process.env.APP_DATABASE_ENVIRONMENT = '';
        process.env.NUBEFACT_ENVIRONMENT = 'DEMO';
        assert.throws(() => validateEnvironment(), /NUBEFACT_ENVIRONMENT es DEMO pero APP_DATABASE_ENVIRONMENT está vacío/);
    });

    await t.test('NUBEFACT_ENABLED=true y APP_DATABASE_ENVIRONMENT vacío falla', () => {
        process.env.APP_DATABASE_ENVIRONMENT = '';
        process.env.NUBEFACT_ENABLED = 'true';
        assert.throws(() => validateEnvironment(), /NUBEFACT_ENABLED=true pero falta APP_DATABASE_ENVIRONMENT/);
    });

    await t.test('Fallback global true falla en DEMO (case insensitive)', () => {
        process.env.APP_DATABASE_ENVIRONMENT = 'DEMO';
        process.env.NUBEFACT_ENVIRONMENT = 'DEMO';
        process.env.DB_NAME = 'farenet_demo';
        process.env.NUBEFACT_ALLOW_GLOBAL_FALLBACK = ' TrUe ';
        assert.throws(() => validateEnvironment(), /No se permite NUBEFACT_ALLOW_GLOBAL_FALLBACK/);
    });

    await t.test('Simulation true falla en DEMO', () => {
        process.env.APP_DATABASE_ENVIRONMENT = 'DEMO';
        process.env.NUBEFACT_ENVIRONMENT = 'DEMO';
        process.env.DB_NAME = 'farenet_demo';
        process.env.NUBEFACT_SIMULATION_ENABLED = 'true';
        assert.throws(() => validateEnvironment(), /No se permite simular/);
    });

    await t.test('Claves legacy true falla en DEMO', () => {
        process.env.APP_DATABASE_ENVIRONMENT = 'DEMO';
        process.env.NUBEFACT_ENVIRONMENT = 'DEMO';
        process.env.DB_NAME = 'farenet_demo';
        process.env.NUBEFACT_ALLOW_LEGACY_CREDENTIAL_KEYS = 'true';
        assert.throws(() => validateEnvironment(), /No se permite NUBEFACT_ALLOW_LEGACY_CREDENTIAL_KEYS/);
    });

    await t.test('Falta variable DB falla', () => {
        process.env.APP_DATABASE_ENVIRONMENT = 'DEMO';
        process.env.NUBEFACT_ENVIRONMENT = 'DEMO';
        process.env.DB_NAME = 'farenet_demo';
        process.env.NUBEFACT_ENABLED = 'true';
        process.env.NUBEFACT_ENVIAR_SUNAT = 'true';
        
        process.env.DB_USER = 'user';
        process.env.DB_HOST = ''; // Missing or empty DB_HOST
        process.env.DB_PASSWORD = 'pass';
        process.env.DB_PORT = '5432';
        process.env.PORT = '3000';

        assert.throws(() => validateEnvironment(), /Variable de entorno obligatoria 'DB_HOST' ausente/);
    });
});
