const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

test('Cargador de Entorno (env-loader)', async (t) => {
    let originalEnv = { ...process.env };
    const loaderPath = path.resolve(__dirname, '../../../config/env-loader');
    
    t.beforeEach(() => {
        process.env = { ...originalEnv };
        delete require.cache[require.resolve(loaderPath)];
    });

    const getLoader = () => require(loaderPath);

    await t.test('aislamiento comprobado y fallback', (t) => {
        // Mock dotenv to spy on the path it gets
        const dotenv = require('dotenv');
        const configMock = t.mock.method(dotenv, 'config', () => {});
        
        // Mock fs.existsSync so it always returns true for our mock files
        const fsExistsMock = t.mock.method(fs, 'existsSync', (filePath) => true);

        // Test with APP_ENV_FILE
        process.env.APP_ENV_FILE = '.env.demo.test_tmp';
        process.env.NODE_ENV = 'development';
        getLoader().loadEnv();
        
        assert.strictEqual(configMock.mock.callCount(), 1, 'Debe llamar a dotenv.config 1 vez');
        const calledPath = configMock.mock.calls[0].arguments[0].path;
        assert.ok(calledPath.includes('.env.demo.test_tmp'), 'Debe cargar el archivo demo solicitado');
        assert.ok(!calledPath.endsWith(path.sep + '.env') && !calledPath.endsWith('/.env'), 'No debe hacer fallback al archivo de produccion');
    });

    await t.test('NODE_ENV=test no carga secretos automaticamente', (t) => {
        process.env.NODE_ENV = 'test';
        // Mock dotenv to spy
        const dotenv = require('dotenv');
        const configMock = t.mock.method(dotenv, 'config', () => {});
        getLoader().loadEnv();
        assert.strictEqual(configMock.mock.callCount(), 0);
    });
});
