const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../../../config/integrations.config');
const service = require('../services/faregas-nubefact-config.service');
const db = require('../../../config/database');

test.after(() => db.end());

const conAliasDemo = async (callback) => {
    const anteriores = {
        alias: process.env.NUBEFACT_FAREGAS_DEMO_CREDENTIAL_ALIAS,
        url: process.env.NUBEFACT_CAMBRIDGE_DEMO_API_URL,
        token: process.env.NUBEFACT_CAMBRIDGE_DEMO_TOKEN,
        ruc: process.env.NUBEFACT_CAMBRIDGE_DEMO_RUC
    };
    process.env.NUBEFACT_FAREGAS_DEMO_CREDENTIAL_ALIAS = 'CAMBRIDGE';
    process.env.NUBEFACT_CAMBRIDGE_DEMO_API_URL = 'https://demo.example.test/api';
    process.env.NUBEFACT_CAMBRIDGE_DEMO_TOKEN = 'test-token';
    process.env.NUBEFACT_CAMBRIDGE_DEMO_RUC = '20600444531';
    try { await callback(); } finally {
        Object.entries(anteriores).forEach(([key, value]) => {
            const envKey = ({ alias: 'NUBEFACT_FAREGAS_DEMO_CREDENTIAL_ALIAS', url: 'NUBEFACT_CAMBRIDGE_DEMO_API_URL', token: 'NUBEFACT_CAMBRIDGE_DEMO_TOKEN', ruc: 'NUBEFACT_CAMBRIDGE_DEMO_RUC' })[key];
            if (value === undefined) delete process.env[envKey]; else process.env[envKey] = value;
        });
    }
};

test('FAREGAS en DEMO usa sólo el alias explícito CAMBRIDGE y sus datos de emisor', async () => {
    await conAliasDemo(async () => {
        const propietario = { empresa_key: 'FAREGAS', entorno: 'DEMO', planta_key: '201' };
        const emisor = {
            empresa_key: 'CAMBRIDGE', entorno: 'DEMO', credencial_clave: 'CAMBRIDGE',
            ruc_emisor: '20600444531', razon_social_emisor: 'I.T.V. CAMBRIDGE S.A.C.', direccion_emisor: 'Dirección demo'
        };
        const executor = { query: async (_sql, params) => {
            assert.deepEqual(params, ['CAMBRIDGE']);
            return { rowCount: 1, rows: [emisor] };
        } };
        const resultado = await service._private.resolverFilaEmisora(propietario, executor);
        const credentials = config.nubefact.obtenerCredenciales(resultado.filaEmisora.credencial_clave, 'DEMO');
        assert.equal(resultado.empresaPropietariaKey, 'FAREGAS');
        assert.equal(resultado.filaEmisora.empresa_key, 'CAMBRIDGE');
        assert.equal(resultado.filaEmisora.razon_social_emisor, 'I.T.V. CAMBRIDGE S.A.C.');
        assert.equal(credentials.rucEmisor, resultado.filaEmisora.ruc_emisor);
        assert.equal(service._private.contextoPublico(resultado.filaEmisora, credentials).configured, true);
    });
});

test('el alias DEMO falla cerrado si no hay facturador activo y no busca otra cuenta', async () => {
    await conAliasDemo(async () => {
        await assert.rejects(
            service._private.resolverFilaEmisora({ empresa_key: 'FAREGAS', entorno: 'DEMO' }, { query: async () => ({ rowCount: 0, rows: [] }) }),
            error => error.code === 'NUBEFACT_ALIAS_DEMO_NO_CONFIGURADO'
        );
    });
});

test('un RUC de credenciales distinto bloquea la configuración pública', () => {
    const fila = { empresa_key: 'CAMBRIDGE', entorno: 'DEMO', ruc_emisor: '20600444531' };
    assert.equal(service._private.contextoPublico(fila, {
        apiUrl: 'https://demo.example.test/api', token: 'test-token', rucEmisor: '20521536463'
    }).configured, false);
});

test('PRODUCCION ignora por completo el alias DEMO', async () => {
    await conAliasDemo(async () => {
        const propietario = { empresa_key: 'FAREGAS', entorno: 'PRODUCCION', credencial_clave: 'FAREGAS' };
        const resultado = await service._private.resolverFilaEmisora(propietario, {
            query: async () => { throw new Error('No debe consultar alias en producción'); }
        });
        assert.equal(resultado.filaEmisora, propietario);
        assert.equal(service._private.aliasDemoPara(propietario), null);
    });
});
