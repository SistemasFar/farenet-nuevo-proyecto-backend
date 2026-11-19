const test = require('node:test');
const assert = require('node:assert/strict');

const dbPath = require.resolve('../../../config/database');
require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: {
        connect: async () => { throw new Error('TEST_NO_DEBE_USAR_POSTGRESQL'); },
        query: async () => { throw new Error('TEST_NO_DEBE_USAR_POSTGRESQL'); },
    },
};

const service = require('../services/faregas-usuarios.service');
const controller = require('../controllers/faregas-usuarios.controller');

const crearRespuesta = () => ({
    statusCode: 200,
    body: null,
    status(codigo) { this.statusCode = codigo; return this; },
    json(body) { this.body = body; return this; },
});

test('el endpoint individual rechaza confirmaciones distintas sin tocar la credencial', async () => {
    const original = service.cambiarPassword;
    let llamadas = 0;
    service.cambiarPassword = async () => { llamadas += 1; };
    try {
        const res = crearRespuesta();
        await controller.cambiarPassword({
            body: { password: 'ClaveSegura#2026', confirmPassword: 'OtraClave#2026' },
            params: { username: 'usuario_prueba' },
        }, res);
        assert.equal(res.statusCode, 400);
        assert.equal(res.body.codigo, 'CONFIRMACION_NO_COINCIDE');
        assert.equal(llamadas, 0);
    } finally {
        service.cambiarPassword = original;
    }
});
