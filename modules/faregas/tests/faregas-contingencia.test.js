const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { clasificarResultado, ausenciaConfirmada, diagnosticarErrorLocal } = require('../services/faregas-contingencia-errores');
const { enviar } = require('../integrations/faregas-contingencia-correo.adapter');

const ausente = {
    httpStatus: 400, status: 'REJECTED', reason: 'REJECTED_BY_PROVIDER',
    data: { errors: 'Documento no existe' }
};

test('distingue fallas temporales, validación, rechazo fiscal y configuración con evidencia estructurada', () => {
    const tests = [
        [{ reason: 'NETWORK_ERROR' }, 'PROVEEDOR_NO_DISPONIBLE', true],
        [{ reason: 'TIMEOUT' }, 'TIMEOUT', true],
        [{ httpStatus: 500 }, 'ERROR_SERVIDOR_PROVEEDOR', true],
        [{ httpStatus: 429, status: 'REJECTED' }, 'SATURACION_TEMPORAL', true],
        [{ httpStatus: 200, provider: 'NUBEFACT' }, 'RESPUESTA_INDETERMINADA', true],
        [{ httpStatus: 400, status: 'REJECTED' }, 'VALIDACION_RECHAZADA', false],
        [{ httpStatus: 200, status: 'REJECTED', data: { sunat_responsecode: '2119' } }, 'RECHAZO_FISCAL', false],
        [{ httpStatus: 401, status: 'REJECTED' }, 'ERROR_CONFIGURACION', false],
        [{}, 'ERROR_INTERNO_FAREGAS', false]
    ];
    for (const [data, categoria, recuperable] of tests) {
        const resultado = clasificarResultado({ status: 'ERROR', ...data }, ausente, 123);
        assert.equal(resultado.categoria, categoria);
        assert.equal(resultado.recuperable, recuperable);
        assert.equal(resultado.ausenciaConfirmada, recuperable);
        assert.equal(resultado.seguimiento, 'FG-INTENTO-123');
    }
    assert.equal(diagnosticarErrorLocal({ code: 'DATOS_NUBEFACT_INVALIDOS' }).categoria, 'VALIDACION_RECHAZADA');
});

test('distingue el límite de 50 comprobantes de una indisponibilidad, incluso en un rechazo guardado', () => {
    const motivo = 'La cuenta DEMO solamente permite emitir 50 documentos. Token: PRIVADO';
    const resultado = clasificarResultado({ status: 'REJECTED', httpStatus: 400, data: { errors: motivo } }, ausente, 9);
    assert.equal(resultado.categoria, 'LIMITE_DEMO_AGOTADO');
    assert.match(resultado.descripcion, /50 comprobantes/);
    assert.equal(resultado.recuperable, false);
    assert.equal(resultado.ausenciaConfirmada, true);
    assert.equal(clasificarResultado({ status: 'REJECTED', httpStatus: 400, data: { errors: motivo } }).ausenciaConfirmada, false);
    assert.doesNotMatch(JSON.stringify(resultado), /PRIVADO/);
    const guardado = diagnosticarErrorLocal({ code: 'NUBEFACT_RECHAZADO', detalles: { motivo } });
    assert.equal(guardado.categoria, 'LIMITE_DEMO_AGOTADO');
    assert.equal(guardado.descripcion, resultado.descripcion);
});

test('la ausencia requiere respuesta explícita y nunca se infiere de un timeout o una identidad encontrada', () => {
    assert.equal(ausenciaConfirmada(ausente), true);
    assert.equal(ausenciaConfirmada({ ...ausente, httpStatus: 504 }), false);
    assert.equal(ausenciaConfirmada({ ...ausente, data: { ...ausente.data, numero: 81 } }), false);
    assert.equal(ausenciaConfirmada({ ...ausente, data: { errors: 'Documento no existe, duplicado' } }), false);
    const conSecreto = clasificarResultado({ status: 'ERROR', reason: 'NETWORK_ERROR', error: 'Bearer SECRET user@example.test' });
    assert.equal(conSecreto.ausenciaConfirmada, false);
    assert.doesNotMatch(JSON.stringify(conSecreto), /SECRET|example/);
});

test('la configuración rechaza la base compartida y producción aunque la bandera esté activa', () => {
    const read = (values) => execFileSync(process.execPath, ['-p', "require('./config/integrations.config').contingencia.habilitada"],
        { cwd: require('node:path').resolve(__dirname, '..', '..', '..'), encoding: 'utf8',
            env: { ...process.env, NODE_ENV: 'test', NUBEFACT_ENABLED: 'true', APP_DATABASE_ENVIRONMENT: 'DESARROLLO',
                NUBEFACT_ENVIRONMENT: 'DEMO', NUBEFACT_ENVIAR_CLIENTE: 'false', FAREGAS_CONTINGENCIA_ENABLED: 'true',
                DB_NAME: 'faregas_contingencia_test', FAREGAS_CONTINGENCIA_DB_NAME: 'faregas_contingencia_test', ...values } }).trim();
    assert.equal(read({}), 'true');
    assert.equal(read({ DB_NAME: 'inspeccion', FAREGAS_CONTINGENCIA_DB_NAME: 'inspeccion' }), 'false');
    assert.equal(read({ NODE_ENV: 'production' }), 'false');
    assert.equal(read({ NUBEFACT_ENVIAR_CLIENTE: 'true' }), 'false');
});

test('el adaptador de correo DEMO usa el buzón de prueba y la misma clave tras una falla', async () => {
    const capturas = [];
    const doc = { facturacion_id: '555', email: 'sistemas@example.test', nro_comprobante: 'FDE1-1',
        fecha_fiscal_original: '2026-11-20', numero_certificado: 'DG-41-1',
        enlace_pdf: 'https://www.nubefact.com/pdf/demo', enlace_xml: 'https://www.nubefact.com/xml/demo' };
    const config = { correoDestinoDemo: 'sistemas@example.test', correoUrl: 'https://relay.example.test',
        correoToken: 'prueba', correoIdempotente: true, correoAdjuntarXml: true };
    const fetch = async (_url, options) => {
        capturas.push(options);
        return capturas.length === 1 ? { status: 503, ok: false }
            : { status: 200, ok: true, json: async () => ({ aceptado: true, referencia: 'envio-1' }) };
    };
    assert.equal((await enviar(doc, { config, fetch })).codigo, 'CORREO_TEMPORAL_503');
    assert.equal((await enviar(doc, { config, fetch })).referencia, 'envio-1');
    assert.equal(capturas[0].headers['Idempotency-Key'], capturas[1].headers['Idempotency-Key']);
    const mensaje = JSON.parse(capturas[1].body);
    assert.equal(mensaje.para, config.correoDestinoDemo);
    assert.match(mensaje.texto, /XML/);
    assert.equal((await enviar({ ...doc, email: 'cliente@example.test' }, { config, fetch })).revision, true);
    assert.equal(capturas.length, 2);
    assert.equal((await enviar({ ...doc, enlace_pdf: 'https://otra.example.test/file' }, { config, fetch })).revision, true);
});