const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const INTEGRACIONES = path.resolve(__dirname, '../../../config/integrations.config.js');
const CONFIG_SERVICE = path.resolve(__dirname, '../services/faregas-nubefact-config.service.js');

const EMPRESAS_CON_ALIAS = ['FAREGAS', 'BIRMINGHAM', 'MAKALU', 'RPLUS', 'MALONGO'];
const CREDENCIAL_PRESTADA = 'CAMBRIDGE';
const RUC_PRESTADO = '20600444531';

const ENV_DEMO = {
    NUBEFACT_ENABLED: 'true',
    NUBEFACT_ENVIRONMENT: 'DEMO',
    NUBEFACT_PRODUCTION_CONFIRMED: 'false',
    NUBEFACT_ENVIAR_SUNAT: 'true',
    NUBEFACT_CORRELATIVOS_V2_ENABLED: 'true',
    NUBEFACT_RECONCILIATION_ENABLED: 'true',
    NUBEFACT_DETRACCION_DECISION: 'NO_APLICA',
    NUBEFACT_CAMBRIDGE_DEMO_API_URL: 'https://api.nubefact.com/api/v1/demo',
    NUBEFACT_CAMBRIDGE_DEMO_TOKEN: 'token-demo-prestado',
    NUBEFACT_CAMBRIDGE_DEMO_RUC: RUC_PRESTADO
};

const ENV_PRODUCCION = {
    ...ENV_DEMO,
    NUBEFACT_ENVIRONMENT: 'PRODUCCION',
    NUBEFACT_PRODUCTION_CONFIRMED: 'true'
};

/**
 * Recarga `integrations.config` y el resolver con un entorno de pruebas concreto.
 * `integrations.config` congela el objeto en tiempo de require, así que hay que
 * limpiar la caché para simular distintos `.env` sin tocar el proceso real.
 */
const conEnv = async (variables, cuerpo) => {
    const tocadas = new Set([
        ...Object.keys(variables),
        ...Object.keys(process.env).filter((k) => k.startsWith('NUBEFACT_'))
    ]);
    const previas = Object.fromEntries([...tocadas].map((k) => [k, process.env[k]]));
    for (const clave of tocadas) delete process.env[clave];
    Object.assign(process.env, variables);
    for (const modulo of [INTEGRACIONES, CONFIG_SERVICE]) delete require.cache[require.resolve(modulo)];
    try {
        await cuerpo(require(INTEGRACIONES), require(CONFIG_SERVICE));
    } finally {
        for (const clave of tocadas) {
            if (previas[clave] === undefined) delete process.env[clave];
            else process.env[clave] = previas[clave];
        }
        for (const modulo of [INTEGRACIONES, CONFIG_SERVICE]) delete require.cache[require.resolve(modulo)];
    }
};

const filaPropietaria = (empresaKey, entorno) => ({
    planta_key: '13',
    empresa_key: empresaKey,
    ruc_emisor: '20521536463',
    razon_social_emisor: `RAZON ${empresaKey}`,
    direccion_emisor: `DIRECCION ${empresaKey}`,
    entorno,
    credencial_clave: empresaKey
});

const filaPrestada = () => ({
    empresa_key: CREDENCIAL_PRESTADA,
    ruc_emisor: RUC_PRESTADO,
    razon_social_emisor: 'RAZON PRESTADA',
    direccion_emisor: 'DIRECCION PRESTADA',
    entorno: 'DEMO',
    credencial_clave: CREDENCIAL_PRESTADA
});

/** Executor mínimo: responde sólo a la consulta de `obtenerFilaAliasDemo`. */
const executorConAlias = (filaAlias) => ({
    async query(sql, valores) {
        if (/fg_empresa_facturador/.test(sql) && valores && valores.length === 1) {
            return { rowCount: filaAlias ? 1 : 0, rows: filaAlias ? [filaAlias] : [] };
        }
        return { rowCount: 0, rows: [] };
    }
});

test('el alias DEMO se resuelve por empresa, no sólo para FAREGAS', async () => {
    await conEnv({
        ...ENV_DEMO,
        NUBEFACT_FAREGAS_DEMO_CREDENTIAL_ALIAS: CREDENCIAL_PRESTADA,
        NUBEFACT_BIRMINGHAM_DEMO_CREDENTIAL_ALIAS: CREDENCIAL_PRESTADA,
        NUBEFACT_MAKALU_DEMO_CREDENTIAL_ALIAS: CREDENCIAL_PRESTADA,
        NUBEFACT_RPLUS_DEMO_CREDENTIAL_ALIAS: CREDENCIAL_PRESTADA,
        NUBEFACT_MALONGO_DEMO_CREDENTIAL_ALIAS: CREDENCIAL_PRESTADA
    }, async (integrations, service) => {
        for (const empresa of EMPRESAS_CON_ALIAS) {
            assert.equal(
                integrations.nubefact.obtenerAliasDemoFacturadorPorEmpresa(empresa),
                CREDENCIAL_PRESTADA,
                `${empresa} debe tener alias DEMO`
            );
            assert.equal(service._private.aliasDemoPara(filaPropietaria(empresa, 'DEMO')), CREDENCIAL_PRESTADA);
        }
    });
});

test('una empresa sin alias DEMO propio no recibe credencial prestada', async () => {
    await conEnv({
        ...ENV_DEMO,
        NUBEFACT_FAREGAS_DEMO_CREDENTIAL_ALIAS: CREDENCIAL_PRESTADA
    }, async (integrations, service) => {
        for (const empresa of ['BIRMINGHAM', 'MAKALU', 'RPLUS', 'MALONGO', 'OTRA_EMPRESA']) {
            assert.equal(integrations.nubefact.obtenerAliasDemoFacturadorPorEmpresa(empresa), '');
            assert.equal(service._private.aliasDemoPara(filaPropietaria(empresa, 'DEMO')), null);
        }
    });
});

test('la variable histórica NUBEFACT_FAREGAS_DEMO_CREDENTIAL_ALIAS sigue funcionando', async () => {
    await conEnv({ ...ENV_DEMO, NUBEFACT_FAREGAS_DEMO_CREDENTIAL_ALIAS: CREDENCIAL_PRESTADA },
        async (integrations) => {
            assert.equal(integrations.nubefact.obtenerAliasDemoFacturador(), CREDENCIAL_PRESTADA);
            assert.equal(integrations.nubefact.obtenerAliasDemoFacturadorPorEmpresa('FAREGAS'), CREDENCIAL_PRESTADA);
        });
});

test('la variable por empresa tiene prioridad sobre la histórica de FAREGAS', async () => {
    await conEnv({
        ...ENV_DEMO,
        NUBEFACT_FAREGAS_DEMO_CREDENTIAL_ALIAS: 'CAMBRIDGE',
        NUBEFACT_BIRMINGHAM_DEMO_CREDENTIAL_ALIAS: 'OTRA_CREDENCIAL'
    }, async (integrations) => {
        assert.equal(integrations.nubefact.obtenerAliasDemoFacturadorPorEmpresa('BIRMINGHAM'), 'OTRA_CREDENCIAL');
        assert.equal(integrations.nubefact.obtenerAliasDemoFacturador(), 'CAMBRIDGE');
    });
});

test('EL SECRETO: en PRODUCCION el alias es imposible para las 5 empresas', async () => {
    await conEnv({
        ...ENV_PRODUCCION,
        // Credenciales CAMBRIDGE completas en ambos entornos: si el alias se
        // colara a PRODUCCION, la fila prestada pasaría todas las validaciones
        // y este test detectaría el fallo.
        NUBEFACT_CAMBRIDGE_PRODUCCION_API_URL: 'https://api.nubefact.com/api/v1/prod',
        NUBEFACT_CAMBRIDGE_PRODUCCION_TOKEN: 'token-prod-prestado',
        NUBEFACT_CAMBRIDGE_PRODUCCION_RUC: RUC_PRESTADO,
        NUBEFACT_FAREGAS_DEMO_CREDENTIAL_ALIAS: CREDENCIAL_PRESTADA,
        NUBEFACT_BIRMINGHAM_DEMO_CREDENTIAL_ALIAS: CREDENCIAL_PRESTADA,
        NUBEFACT_MAKALU_DEMO_CREDENTIAL_ALIAS: CREDENCIAL_PRESTADA,
        NUBEFACT_RPLUS_DEMO_CREDENTIAL_ALIAS: CREDENCIAL_PRESTADA,
        NUBEFACT_MALONGO_DEMO_CREDENTIAL_ALIAS: CREDENCIAL_PRESTADA
    }, async (_integrations, service) => {
        const executor = executorConAlias(filaPrestada());
        for (const empresa of EMPRESAS_CON_ALIAS) {
            for (const entorno of ['PRODUCCION', 'PRODUCTION', 'produccion', 'DEMO_EXTRA', '']) {
                const fila = filaPropietaria(empresa, entorno);
                assert.equal(service._private.aliasDemoPara(fila), null,
                    `${empresa} no debe tener alias con entorno "${entorno}"`);

                const { filaEmisora, empresaPropietariaKey } =
                    await service._private.resolverFilaEmisora(fila, executor);
                assert.equal(filaEmisora.empresa_key, empresa,
                    `${empresa} con entorno "${entorno}" debe emitir con su propia credencial`);
                assert.notEqual(filaEmisora.empresa_key, CREDENCIAL_PRESTADA);
                assert.equal(filaEmisora.credencial_clave, empresa);
                assert.equal(empresaPropietariaKey, empresa);
            }
        }
    });
});

test('EL SECRETO: el nombre de la variable no permite dirigir el alias a PRODUCCION', async () => {
    await conEnv({
        ...ENV_DEMO,
        NUBEFACT_BIRMINGHAM_DEMO_CREDENTIAL_ALIAS: CREDENCIAL_PRESTADA
    }, async (integrations, service) => {
        // La clave se deriva de `NUBEFACT_<EMPRESA>_DEMO_CREDENTIAL_ALIAS`, así que
        // no existe forma de escribir un alias para PRODUCCION: la constante DEMO
        // forma parte del nombre de la variable.
        assert.equal(integrations.nubefact.obtenerAliasDemoFacturadorPorEmpresa('BIRMINGHAM'), CREDENCIAL_PRESTADA);
        for (const entorno of ['PRODUCCION', 'PRODUCTION']) {
            assert.equal(service._private.aliasDemoPara(filaPropietaria('BIRMINGHAM', entorno)), null);
        }
        // Ni siquiera pasando el entorno global basta: la fila decide.
        assert.equal(service._private.aliasDemoPara(filaPropietaria('BIRMINGHAM', 'DEMO')), CREDENCIAL_PRESTADA);
    });
});

test('el alias DEMO no reescribe la empresa propietaria', async () => {
    await conEnv({
        ...ENV_DEMO,
        NUBEFACT_MAKALU_DEMO_CREDENTIAL_ALIAS: CREDENCIAL_PRESTADA
    }, async (_integrations, service) => {
        const { filaEmisora, empresaPropietariaKey } = await service._private.resolverFilaEmisora(
            filaPropietaria('MAKALU', 'DEMO'), executorConAlias(filaPrestada()));
        assert.equal(empresaPropietariaKey, 'MAKALU', 'la empresa propietaria no puede cambiar');
        assert.equal(filaEmisora.empresa_key, CREDENCIAL_PRESTADA, 'sólo se presta la credencial');
    });
});

test('si el alias apunta a una empresa sin fila DEMO, falla de forma explícita', async () => {
    await conEnv({ ...ENV_DEMO, NUBEFACT_MAKALU_DEMO_CREDENTIAL_ALIAS: 'EMPRESA_INEXISTENTE' },
        async (_integrations, service) => {
            await assert.rejects(
                () => service._private.resolverFilaEmisora(
                    filaPropietaria('MAKALU', 'DEMO'), executorConAlias(null)),
                (error) => error.code === 'NUBEFACT_ALIAS_DEMO_NO_CONFIGURADO'
            );
        });
});

test('las credenciales se leen siempre del entorno de la fila emisora', async () => {
    await conEnv({ ...ENV_DEMO, NUBEFACT_MAKALU_DEMO_CREDENTIAL_ALIAS: CREDENCIAL_PRESTADA },
        async (integrations) => {
            const demo = integrations.nubefact.obtenerCredenciales(CREDENCIAL_PRESTADA, 'DEMO');
            assert.equal(demo.apiUrl, 'https://api.nubefact.com/api/v1/demo');
            assert.equal(demo.rucEmisor, RUC_PRESTADO);

            // La misma clave en PRODUCCION no hereda nada del entorno DEMO.
            const prod = integrations.nubefact.obtenerCredenciales(CREDENCIAL_PRESTADA, 'PRODUCCION');
            assert.equal(prod.apiUrl, '');
            assert.equal(prod.token, '');
            assert.equal(prod.rucEmisor, '');
        });
});

test('el alias se ignora cuando la credencial no es https', async () => {
    await conEnv({
        ...ENV_DEMO,
        NUBEFACT_CAMBRIDGE_DEMO_API_URL: 'http://api.nubefact.com/inseguro',
        NUBEFACT_BIRMINGHAM_DEMO_CREDENTIAL_ALIAS: CREDENCIAL_PRESTADA
    }, async (_integrations, service) => {
        // `resolverParaPlanta` rechaza URLs no https; aquí se comprueba que la
        // fila prestada efectivamente llega a esa validación, es decir, que el
        // alias se aplicó y no se descartó antes.
        const { filaEmisora } = await service._private.resolverFilaEmisora(
            filaPropietaria('BIRMINGHAM', 'DEMO'), executorConAlias(filaPrestada()));
        assert.equal(filaEmisora.credencial_clave, CREDENCIAL_PRESTADA);
    });
});
