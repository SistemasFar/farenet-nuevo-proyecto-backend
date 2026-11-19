const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

process.env.FAREGAS_CREDENTIAL_VAULT_KEY = 'b109039e9ab07d7a37a5cec432c149cb587e33e2c41f4eca12d87d2ec8fa8544';

const custodiaService = require('../services/faregas-credencial-custodia.service');

test('cifrarPassword y descifrarPassword cifran y recuperan exactamente el valor con AES-256-GCM', () => {
    const original = 'Clave$Segura#2026!XYZ';
    const cifrado = custodiaService.cifrarPassword(original);

    assert.ok(cifrado.ciphertext);
    assert.ok(cifrado.iv);
    assert.ok(cifrado.tag);
    assert.notEqual(cifrado.ciphertext, original);

    const descifrado = custodiaService.descifrarPassword({
        ciphertext: cifrado.ciphertext,
        iv: cifrado.iv,
        tag: cifrado.tag
    });

    assert.equal(descifrado, original);
});

test('descifrarPassword rechaza manipulación del ciphertext (Auth Tag falla)', () => {
    const original = 'ClaveAutenticada#123';
    const cifrado = custodiaService.cifrarPassword(original);

    // Alterar un byte del ciphertext
    const buffer = Buffer.from(cifrado.ciphertext, 'base64');
    buffer[0] = buffer[0] ^ 0xFF;
    const ciphertextAlterado = buffer.toString('base64');

    assert.throws(
        () => {
            custodiaService.descifrarPassword({
                ciphertext: ciphertextAlterado,
                iv: cifrado.iv,
                tag: cifrado.tag
            });
        },
        /Unsupported state or unable to authenticate data/i
    );
});

test('guardarEnCustodia rechaza cuenta protegida gibarra', async () => {
    const fakeClient = { query: async () => {} };
    await assert.rejects(
        async () => {
            await custodiaService.guardarEnCustodia(fakeClient, {
                username: 'gibarra',
                password: 'password123'
            });
        },
        (err) => {
            assert.equal(err.code, 'USUARIO_PROTEGIDO');
            return true;
        }
    );
});

test('verificarLimiteRevelaciones bloquea más de 5 solicitudes en 1 minuto', () => {
    const admin = 'admin_rate_limit_test';
    // Primeras 5 permitidas
    for (let i = 0; i < 5; i++) {
        custodiaService.verificarLimiteRevelaciones(admin);
    }
    // 6ta rechazada con HTTP 429
    assert.throws(
        () => {
            custodiaService.verificarLimiteRevelaciones(admin);
        },
        (err) => {
            assert.equal(err.code, 'LIMITE_CONSULTAS_EXCEDIDO');
            assert.equal(err.statusCode, 429);
            return true;
        }
    );
});

