const test = require('node:test');
const assert = require('node:assert/strict');

const configPath = require.resolve('../../../config/integrations.config');
const envKeys = ['NODE_ENV', 'NUBEFACT_ENABLED', 'NUBEFACT_SIMULATION_ENABLED'];

const cargarConfig = (env) => {
    const previous = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
    try {
        envKeys.forEach(key => {
            if (env[key] === undefined) delete process.env[key];
            else process.env[key] = env[key];
        });
        delete require.cache[configPath];
        return require(configPath);
    } finally {
        envKeys.forEach(key => {
            if (previous[key] === undefined) delete process.env[key];
            else process.env[key] = previous[key];
        });
        delete require.cache[configPath];
    }
};

test('habilita la simulacion solo cuando Nubefact esta apagado y no es produccion', () => {
    const config = cargarConfig({
        NODE_ENV: 'development',
        NUBEFACT_ENABLED: 'false',
        NUBEFACT_SIMULATION_ENABLED: 'true'
    });
    assert.equal(config.nubefact.simulationEnabled, true);
});

test('deshabilita obligatoriamente la simulacion en produccion', () => {
    const config = cargarConfig({
        NODE_ENV: 'production',
        NUBEFACT_ENABLED: 'false',
        NUBEFACT_SIMULATION_ENABLED: 'true'
    });
    assert.equal(config.nubefact.simulationEnabled, false);
});

test('deshabilita la simulacion cuando Nubefact real esta habilitado', () => {
    const config = cargarConfig({
        NODE_ENV: 'development',
        NUBEFACT_ENABLED: 'true',
        NUBEFACT_SIMULATION_ENABLED: 'true'
    });
    assert.equal(config.nubefact.simulationEnabled, false);
});
