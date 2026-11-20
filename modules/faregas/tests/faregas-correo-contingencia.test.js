const test = require('node:test');
const assert = require('node:assert/strict');
const correo = require('../integrations/faregas-contingencia-correo.adapter');

test('Validaciones del adaptador de correo de contingencia', async (t) => {
    const docBase = {
        facturacion_id: '123',
        codigo_unico: 'FG-123',
        nro_comprobante: 'FFF1-00000070',
        numero_certificado: 'DG-41-000473',
        fecha_fiscal_original: '2026-11-20',
        nombre_razon_social: 'EMPRESA PRUEBA SAC',
        enlace_pdf: 'https://www.nubefact.com/pdf/demo-123',
        enlace_xml: 'https://www.nubefact.com/xml/demo-123'
    };

    await t.test('1. Sin correo o correo nulo: marca sinCorreo sin error y sin intentar envío', async () => {
        assert.equal(correo.correoValido(''), false);
        assert.equal(correo.correoValido(null), false);
        assert.equal(correo.correoValido(undefined), false);

        const res1 = await correo.enviar({ ...docBase, email: '' });
        assert.equal(res1.sinCorreo, true);

        const res2 = await correo.enviar({ ...docBase, email: null });
        assert.equal(res2.sinCorreo, true);
    });

    await t.test('2. Correo con formato inválido: no intenta envío y marca sinCorreo', async () => {
        assert.equal(correo.correoValido('invalido-sin-arroba'), false);
        assert.equal(correo.correoValido('invalido@sin-dominio'), false);
        assert.equal(correo.correoValido('espacio en@correo.pe'), false);

        const res = await correo.enviar({ ...docBase, email: 'correo-invalido' });
        assert.equal(res.sinCorreo, true);
    });

    await t.test('3. Sin credenciales de correo configuradas: devuelve estado pendiente/revisión y NUNCA éxito', async () => {
        const configVacia = { correoUrl: '', correoToken: '', correoDestinoDemo: '' };
        const smtpVacio = { host: '', user: '', pass: '' };

        const res = await correo.enviar(
            { ...docBase, email: 'cliente@valido.pe' },
            { config: configVacia, smtp: smtpVacio }
        );
        assert.equal(res.revision, true);
        assert.equal(res.codigo, 'CORREO_DEMO_NO_CONFIGURADO');
        assert.equal(res.referencia, undefined, 'Jamás debe marcarse referencia si no hay configuración');
    });

    await t.test('4. Correo válido con SMTP simulado exitoso: devuelve referencia Message-ID', async () => {
        const smtpConfig = {
            host: 'smtp.empresa.pe',
            port: 587,
            user: 'notificaciones@empresa.pe',
            pass: 'clave_segura',
            from: 'FAREGAS <notificaciones@empresa.pe>'
        };
        const transporterMock = {
            sendMail: async (options) => {
                assert.equal(options.to, 'cliente@valido.pe');
                assert.match(options.subject, /FFF1-00000070/);
                assert.match(options.text, /https:\/\/www\.nubefact\.com\/pdf\/demo-123/);
                return { messageId: '<msg-id-12345@smtp.empresa.pe>' };
            }
        };

        const res = await correo.enviar(
            { ...docBase, email: 'cliente@valido.pe' },
            { config: {}, smtp: smtpConfig, transporter: transporterMock }
        );
        assert.equal(res.referencia, '<msg-id-12345@smtp.empresa.pe>');
        assert.equal(res.revision, undefined);
    });

    await t.test('5. Fallo de red temporal en SMTP: devuelve código temporal para reintento aislado', async () => {
        const smtpConfig = { host: 'smtp.empresa.pe', user: 'u', pass: 'p' };
        const transporterError = {
            sendMail: async () => {
                const err = new Error('Connection timeout');
                err.code = 'ETIMEDOUT';
                throw err;
            }
        };

        const res = await correo.enviar(
            { ...docBase, email: 'cliente@valido.pe' },
            { config: {}, smtp: smtpConfig, transporter: transporterError }
        );
        assert.equal(res.codigo, 'SMTP_TEMPORAL_ETIMEDOUT');
        assert.equal(res.referencia, undefined);
    });

    await t.test('6. PDF fiscal inválido: no envía correo y solicita revisión', async () => {
        const docInvalido = { ...docBase, email: 'cliente@valido.pe', enlace_pdf: 'http://malicioso.com/pdf' };
        const res = await correo.enviar(docInvalido);
        assert.equal(res.revision, true);
        assert.equal(res.codigo, 'PDF_FISCAL_NO_VERIFICABLE');
    });
});

