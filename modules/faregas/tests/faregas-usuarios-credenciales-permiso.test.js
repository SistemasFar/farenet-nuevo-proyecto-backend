const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');

const dbPath = require.resolve('../../../config/database');
const controllerPath = require.resolve('../controllers/faregas-usuarios.controller');
const routesPath = require.resolve('../routes/faregas-usuarios.routes');

const iniciarServidorDePrueba = async (perfil, permisos) => {
    const anteriorDb = require.cache[dbPath];
    const anteriorController = require.cache[controllerPath];
    const anteriorRoutes = require.cache[routesPath];
    const secretoAnterior = process.env.JWT_SECRET_FAREGAS;
    const secreto = 'credenciales-test-secret';
    process.env.JWT_SECRET_FAREGAS = secreto;

    require.cache[dbPath] = {
        id: dbPath,
        filename: dbPath,
        loaded: true,
        exports: {
            query: async (sql) => {
                if (/SELECT estado, perfil_id FROM fg_usuario/i.test(sql)) {
                    return { rowCount: 1, rows: [{ estado: true, perfil_id: perfil }] };
                }
                if (/SELECT pp\.permiso_clave/i.test(sql)) {
                    return { rowCount: permisos.length, rows: permisos.map((permiso_clave) => ({ permiso_clave })) };
                }
                throw new Error('Unexpected query in permission test');
            },
        },
    };

    const handler = (req, res) => res.status(202).json({
        success: true,
        actorPerfil: req.user.perfil_id,
        actorPermisos: req.user.permisos,
    });
    require.cache[controllerPath] = {
        id: controllerPath,
        filename: controllerPath,
        loaded: true,
        exports: new Proxy({}, { get: () => handler }),
    };
    delete require.cache[routesPath];
    const router = require(routesPath);
    const app = express();
    app.use(express.json());
    app.use('/usuarios', router);
    const server = await new Promise((resolve, reject) => {
        const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
        listening.once('error', reject);
    });

    return {
        server,
        secret: secreto,
        restore: () => {
            server.closeAllConnections?.();
            server.close();
            if (anteriorDb) require.cache[dbPath] = anteriorDb;
            else delete require.cache[dbPath];
            if (anteriorController) require.cache[controllerPath] = anteriorController;
            else delete require.cache[controllerPath];
            if (anteriorRoutes) require.cache[routesPath] = anteriorRoutes;
            else delete require.cache[routesPath];
            if (secretoAnterior === undefined) delete process.env.JWT_SECRET_FAREGAS;
            else process.env.JWT_SECRET_FAREGAS = secretoAnterior;
        },
    };
};

test('MENU_USUARIOS permite cambiar una contraseña individual sin depender del perfil SISTEMAS', async () => {
    const app = await iniciarServidorDePrueba('CONTADOR', ['MENU_USUARIOS']);
    try {
        const address = app.server.address();
        const token = jwt.sign({ username: 'contador_admin', faregas_flow: 'authenticated' }, app.secret);
        const response = await fetch(`http://127.0.0.1:${address.port}/usuarios/usuario_prueba/password`, {
            method: 'PATCH',
            headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
            body: JSON.stringify({ password: 'ClaveSegura#2026', confirmPassword: 'ClaveSegura#2026' }),
        });
        const body = await response.json();
        assert.equal(response.status, 202);
        assert.equal(body.actorPerfil, 'CONTADOR');
        assert.deepEqual(body.actorPermisos, ['MENU_USUARIOS']);
    } finally {
        app.restore();
    }
});

test('rechaza el cambio individual cuando el perfil vigente no tiene MENU_USUARIOS', async () => {
    const app = await iniciarServidorDePrueba('OPERADOR', ['MENU_DASHBOARD']);
    try {
        const address = app.server.address();
        const token = jwt.sign({ username: 'operador', faregas_flow: 'authenticated' }, app.secret);
        const response = await fetch(`http://127.0.0.1:${address.port}/usuarios/usuario_prueba/password`, {
            method: 'PATCH',
            headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
            body: JSON.stringify({ password: 'ClaveSegura#2026', confirmPassword: 'ClaveSegura#2026' }),
        });
        assert.equal(response.status, 403);
    } finally {
        app.restore();
    }
});
