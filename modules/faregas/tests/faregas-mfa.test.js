const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

// Configurar entorno de pruebas
process.env.FAREGAS_CREDENTIAL_VAULT_KEY = process.env.FAREGAS_CREDENTIAL_VAULT_KEY
    || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const mfaService = require('../services/faregas-mfa.service');
const custodiaService = require('../services/faregas-credencial-custodia.service');
const usuariosController = require('../controllers/faregas-usuarios.controller');
const auditoriaService = require('../services/faregas-auditoria.service');
const authService = require('../services/faregas-auth.service');

test('MFA: Base32 codifica y decodifica exactamente respetando RFC 4648', () => {
    const original = Buffer.from('FAREGAS-SECURITY-TEST-2026', 'utf8');
    const encoded = mfaService.base32Encode(original);
    assert.ok(/^[A-Z2-7]+$/.test(encoded));
    const decoded = mfaService.base32Decode(encoded);
    assert.deepEqual(decoded, original);
});

test('MFA: TOTP genera y valida código de 6 dígitos con ventana de deriva y previene replay', () => {
    const secretBuffer = crypto.randomBytes(20);
    const secretBase32 = mfaService.base32Encode(secretBuffer);

    const now = 1700000000000;
    const currentStep = Math.floor(now / 1000 / 30);
    const validOtp = mfaService.generarHotp(secretBuffer, currentStep);

    assert.equal(validOtp.length, 6);
    assert.ok(/^\d{6}$/.test(validOtp));

    // 1. Verificación en tiempo exacto
    const resExacto = mfaService.verificarTotp(secretBase32, validOtp, { timestamp: now });
    assert.equal(resExacto.valido, true);
    assert.equal(resExacto.step, currentStep);

    // 2. Verificación con deriva de 25 segundos atrás (mismo paso o ventana -1)
    const resAtras = mfaService.verificarTotp(secretBase32, validOtp, { timestamp: now + 25000 });
    assert.equal(resAtras.valido, true);

    // 3. Código incorrecto es rechazado
    const resInvalido = mfaService.verificarTotp(secretBase32, '999999', { timestamp: now });
    assert.equal(resInvalido.valido, false);

    // 4. Protección contra repetición (token replay)
    const resReplay = mfaService.verificarTotp(secretBase32, validOtp, {
        timestamp: now,
        ultimoPasoUsado: currentStep
    });
    assert.equal(resReplay.valido, false);
});

test('MFA: Códigos de recuperación únicos (XXXX-XXXX) son de un solo uso', () => {
    const { codigosPlano, codigosHashed } = mfaService.generarCodigosRecuperacion(4);
    assert.equal(codigosPlano.length, 4);
    assert.equal(codigosHashed.length, 4);

    const codigoAEsperar = codigosPlano[0];

    // 1. Primer uso es exitoso
    const primerUso = mfaService.verificarYConsumirCodigoRecuperacion(codigosHashed, codigoAEsperar);
    assert.equal(primerUso.valido, true);
    assert.equal(primerUso.codigosRestantes, 3);

    // 2. Segundo intento con el mismo código es rechazado (ya consumido)
    const segundoUso = mfaService.verificarYConsumirCodigoRecuperacion(primerUso.codigosActualizados, codigoAEsperar);
    assert.equal(segundoUso.valido, false);
});

test('MFA: Cifrado y descifrado de secreto en reposo con AES-256-GCM', () => {
    const secret = 'JBSWY3DPEHPK3PXP';
    const cifrado = mfaService.cifrarSecreto(secret);
    assert.ok(cifrado.ciphertext);
    assert.ok(cifrado.iv);
    assert.ok(cifrado.tag);

    const descifrado = mfaService.descirado || mfaService.descifrarSecreto(cifrado);
    assert.equal(descifrado, secret);
});

test('MFA: verificarPasoAutorizacion valida por Contraseña, TOTP o Código de Recuperación con rate limiting', async () => {
    mfaService.limpiarIntentosFallidos('admin_test');

    const mockAuthService = {
        validarFaregas: async (username, password) => {
            if (password === 'CorrectPass#2026') return { valido: true };
            return { valido: false };
        }
    };

    const secretBuffer = crypto.randomBytes(20);
    const secretBase32 = mfaService.base32Encode(secretBuffer);
    const cifrado = mfaService.cifrarSecreto(secretBase32);
    const { codigosPlano, codigosHashed } = mfaService.generarCodigosRecuperacion(4);

    let mfaRow = {
        activo: true,
        secreto_cifrado: cifrado.ciphertext,
        secreto_iv: cifrado.iv,
        secreto_tag: cifrado.tag,
        codigos_recuperacion: codigosHashed,
        ultimo_paso_usado: null
    };

    const mockDb = {
        query: async (sql, params) => {
            if (sql.includes('SELECT activo, secreto_cifrado')) {
                return { rowCount: 1, rows: [mfaRow] };
            }
            if (sql.includes('SELECT activo, codigos_recuperacion')) {
                return { rowCount: 1, rows: [mfaRow] };
            }
            if (sql.includes('UPDATE public.fg_usuario_mfa SET ultimo_paso_usado')) {
                mfaRow.ultimo_paso_usado = params[0];
                return { rowCount: 1 };
            }
            if (sql.includes('UPDATE public.fg_usuario_mfa SET codigos_recuperacion')) {
                mfaRow.codigos_recuperacion = JSON.parse(params[0]);
                return { rowCount: 1 };
            }
            return { rowCount: 0, rows: [] };
        }
    };

    // 1. Verificación válida por contraseña
    const resPass = await mfaService.verificarPasoAutorizacion(
        mockDb,
        'admin_test',
        { passwordAdmin: 'CorrectPass#2026' },
        mockAuthService
    );
    assert.equal(resPass.valido, true);
    assert.equal(resPass.metodo, 'PASSWORD');

    // 2. Contraseña errónea
    const resPassFail = await mfaService.verificarPasoAutorizacion(
        mockDb,
        'admin_test',
        { passwordAdmin: 'WrongPass' },
        mockAuthService
    );
    assert.equal(resPassFail.valido, false);

    // 3. Verificación válida por TOTP
    const currentStep = Math.floor(Date.now() / 1000 / 30);
    const totpCode = mfaService.generarHotp(secretBuffer, currentStep);
    const resTotp = await mfaService.verificarPasoAutorizacion(
        mockDb,
        'admin_test',
        { codigoTotp: totpCode },
        mockAuthService
    );
    assert.equal(resTotp.valido, true);
    assert.equal(resTotp.metodo, 'TOTP');

    // 4. Verificación válida por Código de Recuperación
    const resRec = await mfaService.verificarPasoAutorizacion(
        mockDb,
        'admin_test',
        { codigoRecuperacion: codigosPlano[0] },
        mockAuthService
    );
    assert.equal(resRec.valido, true);
    assert.equal(resRec.metodo, 'CODIGO_RECUPERACION');
    assert.equal(resRec.codigosRestantes, 3);
});

test('controller.revelarCredencialCustodiada autoriza mediante TOTP y registra auditoría', async () => {
    const eventosAuditados = [];
    const origRegistrar = auditoriaService.registrarEvento;
    const origObtenerDescifrada = custodiaService.obtenerCredencialDescifrada;
    const origVerificarPaso = mfaService.verificarPasoAutorizacion;

    auditoriaService.registrarEvento = async (ev) => { eventosAuditados.push(ev); };
    custodiaService.obtenerCredencialDescifrada = async () => ({
        username: 'jsturt',
        password: 'ClaveReveladaPorTOTP#1',
        creadoPor: 'gibarra',
        fechaActualizacion: new Date().toISOString()
    });

    try {
        // Mock autorizar por TOTP
        mfaService.verificarPasoAutorizacion = async () => ({
            valido: true,
            metodo: 'TOTP'
        });

        let statusCode = 200;
        let responseJson = null;

        const req = {
            params: { username: 'jsturt' },
            user: { username: 'admin' },
            body: { codigoTotp: '123456' },
            ip: '127.0.0.1'
        };

        const res = {
            status: (code) => { statusCode = code; return res; },
            set: () => {},
            json: (data) => { responseJson = data; return res; }
        };

        await usuariosController.revelarCredencialCustodiada(req, res);

        assert.equal(statusCode, 200);
        assert.equal(responseJson.success, true);
        assert.equal(responseJson.password, 'ClaveReveladaPorTOTP#1');
        assert.equal(responseJson.metodoAutorizacion, 'TOTP');

        const auditEvent = eventosAuditados.find(e => e.evento === 'CREDENCIAL_REVELADA');
        assert.ok(auditEvent);
        assert.ok(auditEvent.mensaje.includes('mediante TOTP'));
    } finally {
        auditoriaService.registrarEvento = origRegistrar;
        custodiaService.obtenerCredencialDescifrada = origObtenerDescifrada;
        mfaService.verificarPasoAutorizacion = origVerificarPaso;
    }
});

