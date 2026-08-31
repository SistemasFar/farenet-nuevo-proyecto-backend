const test = require('node:test');
const assert = require('node:assert/strict');
const nubefactService = require('../../../services/integrations/nubefact.service');
const integrationsConfig = require('../../../config/integrations.config');

const credentials = {
    apiUrl: 'https://demo.example.test/api',
    token: 'token-secreto-de-prueba'
};

test('envia el token Nubefact crudo y no con prefijo Bearer o Token', async () => {
    let llamada;
    const httpClient = {
        post: async (url, payload, options) => {
            llamada = { url, payload, options };
            return { status: 200, data: { aceptada_por_sunat: true } };
        }
    };

    const resultado = await nubefactService.emitirComprobante(
        { operacion: 'generar_comprobante' },
        { credentials, httpClient, ignoreEnabled: true }
    );

    assert.equal(resultado.status, 'ACCEPTED');
    assert.equal(llamada.url, credentials.apiUrl);
    assert.equal(llamada.options.headers.Authorization, credentials.token);
    assert.equal(llamada.options.headers.Authorization.includes('Bearer'), false);
    assert.equal(llamada.options.headers.Authorization.includes('Token '), false);
});

test('consulta el comprobante por tipo, serie y numero para recuperar un reintento incierto', async () => {
    let payloadEnviado;
    const httpClient = {
        post: async (_url, payload) => {
            payloadEnviado = payload;
            return { status: 200, data: { aceptada_por_sunat: true } };
        }
    };

    const resultado = await nubefactService.consultarComprobante(
        { tipoDeComprobante: 1, serie: 'FE01', numero: 42 },
        { credentials, httpClient, ignoreEnabled: true }
    );

    assert.equal(resultado.status, 'ACCEPTED');
    assert.deepEqual(payloadEnviado, {
        operacion: 'consultar_comprobante',
        tipo_de_comprobante: 1,
        serie: 'FE01',
        numero: 42
    });
});

test('no intenta red cuando faltan las credenciales de la empresa', async () => {
    let llamadas = 0;
    const httpClient = { post: async () => { llamadas += 1; } };
    const resultado = await nubefactService.emitirComprobante(
        { operacion: 'generar_comprobante' },
        { credentials: null, httpClient, ignoreEnabled: true }
    );
    assert.equal(resultado.status, 'CONFIGURATION_ERROR');
    assert.equal(llamadas, 0);
});

test('la anulacion asincrona conserva el ticket como pendiente de SUNAT', async () => {
    let payloadEnviado;
    const httpClient = {
        post: async (_url, payload) => {
            payloadEnviado = payload;
            return { status: 200, data: { sunat_ticket_numero: 'TICKET-123' } };
        }
    };
    const resultado = await nubefactService.generarAnulacion({
        tipoDeComprobante: 1, serie: 'FE01', numero: 42,
        motivo: 'ERROR DE EMISION', codigoUnico: 'FGA-42'
    }, { credentials, httpClient, ignoreEnabled: true });
    assert.equal(resultado.status, 'PROCESSING');
    assert.equal(resultado.reason, 'PENDING_SUNAT');
    assert.equal(payloadEnviado.operacion, 'generar_anulacion');
    assert.equal(payloadEnviado.codigo_unico, 'FGA-42');
});

test('resuelve las credenciales por clave de empresa sin exponerlas en el estado publico', () => {
    process.env.NUBEFACT_EMPRESA_PRUEBA_API_URL = credentials.apiUrl;
    process.env.NUBEFACT_EMPRESA_PRUEBA_TOKEN = credentials.token;
    try {
        const resolved = integrationsConfig.nubefact.obtenerCredenciales('empresa-prueba');
        assert.equal(resolved.apiUrl, credentials.apiUrl);
        assert.equal(resolved.token, credentials.token);
        const estado = nubefactService.obtenerEstadoConfiguracion(resolved);
        assert.deepEqual(Object.keys(estado).sort(), ['configured', 'enabled', 'environment', 'provider']);
        assert.equal(JSON.stringify(estado).includes(credentials.token), false);
        assert.equal(JSON.stringify(estado).includes(credentials.apiUrl), false);
    } finally {
        delete process.env.NUBEFACT_EMPRESA_PRUEBA_API_URL;
        delete process.env.NUBEFACT_EMPRESA_PRUEBA_TOKEN;
    }
});
