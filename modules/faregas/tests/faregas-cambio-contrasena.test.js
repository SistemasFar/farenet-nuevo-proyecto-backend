const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const authService = require('../services/faregas-auth.service');
const authController = require('../controllers/faregas-auth.controller');
const { authFaregasMiddleware } = require('../middlewares/faregas-auth.middleware');

const JWT_SECRET_TEST = process.env.JWT_SECRET_FAREGAS || 'real_faregas_secret_for_dev_12345';

// Mock de base de datos en memoria para pruebas completamente aisladas
function createMockExecutor(initialState = {}) {
    const state = {
        users: {
            operador1: {
                username: 'operador1',
                contrasenha: bcrypt.hashSync('PasswordActual2026**', 10),
                perfil_id: 'OPERADOR',
                estado: true,
                user_type: 'OPERADOR'
            },
            inactivo1: {
                username: 'inactivo1',
                contrasenha: bcrypt.hashSync('PasswordInactivo2026**', 10),
                perfil_id: 'OPERADOR',
                estado: false,
                user_type: 'OPERADOR'
            },
            ...(initialState.users || {})
        },
        sessions: [
            { id: 1, usuario_username: 'operador1', session_jti: 'session-uuid-1', isactive: true },
            { id: 2, usuario_username: 'operador1', session_jti: 'session-uuid-2', isactive: true },
            { id: 3, usuario_username: 'otro_usuario', session_jti: 'session-uuid-3', isactive: true },
            ...(initialState.sessions || [])
        ],
        auditLogs: [],
        queries: []
    };

    const executor = {
        state,
        async query(sql, params = []) {
            state.queries.push({ sql, params });
            const s = sql.trim();

            if (s === 'BEGIN' || s === 'COMMIT' || s === 'ROLLBACK') {
                return { rowCount: 1, rows: [] };
            }

            // SELECT fg_usuario
            if (s.includes('FROM fg_usuario') && s.includes('WHERE TRIM(username) = $1')) {
                const u = state.users[params[0]];
                if (u) {
                    return { rowCount: 1, rows: [{ ...u }] };
                }
                return { rowCount: 0, rows: [] };
            }

            // UPDATE fg_usuario
            if (s.includes('UPDATE fg_usuario') && s.includes('SET contrasenha = $1')) {
                const hash = params[0];
                const username = params[1];
                if (state.users[username]) {
                    state.users[username].contrasenha = hash;
                    return { rowCount: 1, rows: [] };
                }
                return { rowCount: 0, rows: [] };
            }

            // UPDATE fg_usuario_sesion (revocación)
            if (s.includes('UPDATE fg_usuario_sesion') && s.includes('SET isactive = false')) {
                const username = params[0];
                let count = 0;
                state.sessions.forEach(sess => {
                    if (sess.usuario_username === username && sess.isactive) {
                        sess.isactive = false;
                        count++;
                    }
                });
                return { rowCount: count, rows: Array(count).fill({ id: 1 }) };
            }

            // SELECT isactive FROM fg_usuario_sesion
            if (s.includes('FROM fg_usuario_sesion') && s.includes('WHERE session_jti = $1')) {
                const sess = state.sessions.find(x => x.session_jti === params[0] && x.usuario_username === params[1]);
                if (sess) {
                    return { rowCount: 1, rows: [{ isactive: sess.isactive }] };
                }
                return { rowCount: 0, rows: [] };
            }

            // INSERT INTO fg_auditoria_acceso
            if (s.includes('INSERT INTO fg_auditoria_acceso')) {
                state.auditLogs.push({
                    username: params[0],
                    evento: params[1],
                    exitoso: params[2],
                    mensaje: params[3],
                    planta_key: params[4],
                    ip_direccion: params[5],
                    user_agent: params[6],
                    perfil: params[7],
                    categoria: params[8],
                    entidad: params[9],
                    datos: params[16] ? JSON.parse(params[16]) : null
                });
                return { rowCount: 1, rows: [] };
            }

            return { rowCount: 0, rows: [] };
        }
    };

    const mockAuditoria = {
        async registrarEvento(payload) {
            state.auditLogs.push(payload);
            return true;
        }
    };

    return { executor, mockAuditoria };
}

test('FAREGAS — Suite Completa de Cambio de Contraseña y Seguridad', async (suite) => {

    await suite.test('1. Contraseña actual correcta permite procesar la solicitud', async () => {
        const { executor, mockAuditoria } = createMockExecutor();
        authService.limpiarIntentosFallidos('operador1');

        const resultado = await authService.cambiarContrasenhaUsuario({
            username: 'operador1',
            contrasenhaActual: 'PasswordActual2026**',
            contrasenhaNueva: 'NuevoPasswordSeguro2026!',
            confirmarContrasenha: 'NuevoPasswordSeguro2026!',
            ip: '192.168.1.50',
            userAgent: 'Mozilla/5.0 Test',
            sessionJti: 'session-uuid-1',
            plantaKey: '98',
            executor,
            auditoria: mockAuditoria
        });

        assert.equal(resultado.success, true);
        assert.equal(resultado.sesionesRevocadas, 2);
    });

    await suite.test('2. Contraseña actual incorrecta es rechazada y auditada con fallo', async () => {
        const { executor, mockAuditoria } = createMockExecutor();
        authService.limpiarIntentosFallidos('operador1');

        await assert.rejects(
            async () => {
                await authService.cambiarContrasenhaUsuario({
                    username: 'operador1',
                    contrasenhaActual: 'PasswordEquivocada123',
                    contrasenhaNueva: 'NuevoPasswordSeguro2026!',
                    confirmarContrasenha: 'NuevoPasswordSeguro2026!',
                    ip: '192.168.1.50',
                    userAgent: 'Mozilla/5.0 Test',
                    executor,
                    auditoria: mockAuditoria
                });
            },
            {
                message: 'La contraseña actual es incorrecta.'
            }
        );

        // Verificar que se registró auditoría con fallo
        const logFallo = executor.state.auditLogs.find(l => l.evento === 'CAMBIO_CONTRASENA' && l.exitoso === false);
        assert.ok(logFallo, 'Debe registrarse auditoría del fallo');
        assert.equal(logFallo.username, 'operador1');
        assert.equal(logFallo.datos?.motivo, 'PASSWORD_ACTUAL_INCORRECTA');
    });

    await suite.test('3. Confirmación distinta es rechazada de inmediato', async () => {
        const { executor, mockAuditoria } = createMockExecutor();

        await assert.rejects(
            async () => {
                await authService.cambiarContrasenhaUsuario({
                    username: 'operador1',
                    contrasenhaActual: 'PasswordActual2026**',
                    contrasenhaNueva: 'NuevoPasswordSeguro2026!',
                    confirmarContrasenha: 'PasswordDiferenteTotalmente999!',
                    executor,
                    auditoria: mockAuditoria
                });
            },
            {
                message: 'La nueva contraseña y su confirmación no coinciden.'
            }
        );
    });

    await suite.test('4. Nueva contraseña igual a la anterior es rechazada', async () => {
        const { executor, mockAuditoria } = createMockExecutor();
        authService.limpiarIntentosFallidos('operador1');

        await assert.rejects(
            async () => {
                await authService.cambiarContrasenhaUsuario({
                    username: 'operador1',
                    contrasenhaActual: 'PasswordActual2026**',
                    contrasenhaNueva: 'PasswordActual2026**',
                    confirmarContrasenha: 'PasswordActual2026**',
                    executor,
                    auditoria: mockAuditoria
                });
            },
            {
                message: 'La nueva contraseña debe ser diferente de la contraseña actual.'
            }
        );
    });

    await suite.test('5. Nueva contraseña demasiado débil o trivial es rechazada', async () => {
        const { executor, mockAuditoria } = createMockExecutor();

        // 5.1 Menor a 12 caracteres
        await assert.rejects(
            async () => {
                await authService.cambiarContrasenhaUsuario({
                    username: 'operador1',
                    contrasenhaActual: 'PasswordActual2026**',
                    contrasenhaNueva: 'Corta123!',
                    confirmarContrasenha: 'Corta123!',
                    executor,
                    auditoria: mockAuditoria
                });
            },
            { message: 'La nueva contraseña debe tener al menos 12 caracteres.' }
        );

        // 5.2 Sin mayúsculas
        await assert.rejects(
            async () => {
                await authService.cambiarContrasenhaUsuario({
                    username: 'operador1',
                    contrasenhaActual: 'PasswordActual2026**',
                    contrasenhaNueva: 'sinmayusculas123!',
                    confirmarContrasenha: 'sinmayusculas123!',
                    executor,
                    auditoria: mockAuditoria
                });
            },
            { message: 'La nueva contraseña debe contener al menos una mayúscula, una minúscula y un número o símbolo.' }
        );

        // 5.3 Sin número ni símbolo
        await assert.rejects(
            async () => {
                await authService.cambiarContrasenhaUsuario({
                    username: 'operador1',
                    contrasenhaActual: 'PasswordActual2026**',
                    contrasenhaNueva: 'SoloLetrasGrandesYChicas',
                    confirmarContrasenha: 'SoloLetrasGrandesYChicas',
                    executor,
                    auditoria: mockAuditoria
                });
            },
            { message: 'La nueva contraseña debe contener al menos una mayúscula, una minúscula y un número o símbolo.' }
        );

        // 5.4 Contraseña trivial predecible
        await assert.rejects(
            async () => {
                await authService.cambiarContrasenhaUsuario({
                    username: 'operador1',
                    contrasenhaActual: 'PasswordActual2026**',
                    contrasenhaNueva: '123456789012',
                    confirmarContrasenha: '123456789012',
                    executor,
                    auditoria: mockAuditoria
                });
            },
            { message: 'La nueva contraseña debe contener al menos una mayúscula, una minúscula y un número o símbolo.' }
        );

        // 5.5 Contraseña que contiene el username
        await assert.rejects(
            async () => {
                await authService.cambiarContrasenhaUsuario({
                    username: 'operador1',
                    contrasenhaActual: 'PasswordActual2026**',
                    contrasenhaNueva: 'MiClave_operador1_2026!',
                    confirmarContrasenha: 'MiClave_operador1_2026!',
                    executor,
                    auditoria: mockAuditoria
                });
            },
            { message: 'La nueva contraseña no puede contener el nombre de usuario.' }
        );
    });

    await suite.test('6. Intento sin autenticación en endpoint es rechazado con HTTP 401', async () => {
        let statusRes = null;
        let jsonRes = null;

        const req = {
            headers: {},
            body: { currentPassword: 'foo', newPassword: 'bar', confirmPassword: 'bar' }
        };
        const res = {
            status(code) { statusRes = code; return this; },
            json(data) { jsonRes = data; return this; }
        };
        const next = () => { assert.fail('No debe llamar a next() sin token'); };

        await authFaregasMiddleware(req, res, next);
        assert.equal(statusRes, 401);
        assert.equal(jsonRes.message, 'Token requerido');
    });

    await suite.test('7. Intento de cambiar contraseña de otro usuario es frustrado: solo opera sobre el token', async () => {
        let usuarioLlamado = null;
        const originalMetodo = authService.cambiarContrasenhaUsuario;

        // Stub temporal del servicio para comprobar qué usuario recibe el controlador
        authService.cambiarContrasenhaUsuario = async (params) => {
            usuarioLlamado = params.username;
            return { success: true, sesionesRevocadas: 1 };
        };

        try {
            let responseStatus = null;
            let responseJson = null;

            const req = {
                user: {
                    username: 'operador_autenticado', // Usuario legítimo en el token
                    session_jti: 'session-uuid-1',
                    planta_key: '98'
                },
                body: {
                    username: 'victima_inyeccion', // Intento de inyectar otro usuario en el body
                    usuario_id: 999,
                    currentPassword: 'PasswordActual2026**',
                    newPassword: 'NuevoPasswordValido2026*',
                    confirmPassword: 'NuevoPasswordValido2026*'
                },
                headers: { 'user-agent': 'Agent-Test' },
                socket: { remoteAddress: '127.0.0.1' }
            };
            const res = {
                status(code) { responseStatus = code; return this; },
                json(data) { responseJson = data; return this; }
            };

            await authController.cambiarContrasena(req, res);
            assert.equal(responseStatus, 200);
            assert.equal(responseJson.success, true);
            // Comprobación crítica: El usuario procesado debe ser 'operador_autenticado', NUNCA 'victima_inyeccion'
            assert.equal(usuarioLlamado, 'operador_autenticado');
        } finally {
            authService.cambiarContrasenhaUsuario = originalMetodo;
        }
    });

    await suite.test('8. Usuario inactivo es rechazado', async () => {
        const { executor, mockAuditoria } = createMockExecutor();

        await assert.rejects(
            async () => {
                await authService.cambiarContrasenhaUsuario({
                    username: 'inactivo1',
                    contrasenhaActual: 'PasswordInactivo2026**',
                    contrasenhaNueva: 'NuevoPasswordValido2026*',
                    confirmarContrasenha: 'NuevoPasswordValido2026*',
                    executor,
                    auditoria: mockAuditoria
                });
            },
            {
                message: 'El usuario se encuentra inactivo.'
            }
        );
    });

    await suite.test('9. Cambio exitoso actualiza el hash de fg_usuario con bcrypt seguro', async () => {
        const { executor, mockAuditoria } = createMockExecutor();
        authService.limpiarIntentosFallidos('operador1');

        const resultado = await authService.cambiarContrasenhaUsuario({
            username: 'operador1',
            contrasenhaActual: 'PasswordActual2026**',
            contrasenhaNueva: 'MiNuevaSuperClave2026$$',
            confirmarContrasenha: 'MiNuevaSuperClave2026$$',
            ip: '10.0.0.1',
            userAgent: 'Chrome/120',
            sessionJti: 'session-uuid-1',
            plantaKey: '98',
            executor,
            auditoria: mockAuditoria
        });

        assert.equal(resultado.success, true);
        const nuevoHash = executor.state.users.operador1.contrasenha;
        assert.ok(nuevoHash.startsWith('$2a$') || nuevoHash.startsWith('$2b$'), 'Debe ser un hash bcrypt');
        assert.ok(bcrypt.compareSync('MiNuevaSuperClave2026$$', nuevoHash), 'La nueva clave debe verificar contra el hash');
    });

    await suite.test('10. Registro correcto de auditoría contiene metadatos y CERO contraseñas', async () => {
        const { executor, mockAuditoria } = createMockExecutor();
        authService.limpiarIntentosFallidos('operador1');

        await authService.cambiarContrasenhaUsuario({
            username: 'operador1',
            contrasenhaActual: 'PasswordActual2026**',
            contrasenhaNueva: 'MiNuevaSuperClave2026$$',
            confirmarContrasenha: 'MiNuevaSuperClave2026$$',
            ip: '10.0.0.1',
            userAgent: 'Chrome/120',
            sessionJti: 'session-uuid-1',
            plantaKey: '98',
            executor,
            auditoria: mockAuditoria
        });

        const logExito = executor.state.auditLogs.find(l => l.evento === 'CAMBIO_CONTRASENA' && l.exitoso === true);
        assert.ok(logExito, 'Debe existir registro de auditoría exitoso');
        assert.equal(logExito.username, 'operador1');
        assert.equal(logExito.categoria, 'SEGURIDAD');
        assert.equal(logExito.entidad, 'fg_usuario');
        assert.equal(logExito.planta_key, '98');
        assert.equal(logExito.ip_direccion, '10.0.0.1');

        // SEGURIDAD CRÍTICA: Ningún campo de auditoría ni datos JSONB debe contener contraseñas ni hashes
        const textoCompleto = JSON.stringify(logExito);
        assert.doesNotMatch(textoCompleto, /PasswordActual2026/);
        assert.doesNotMatch(textoCompleto, /MiNuevaSuperClave2026/);
        assert.doesNotMatch(textoCompleto, /\$2[aby]\$/);
    });

    await suite.test('11. Revocación de sesiones activas en fg_usuario_sesion', async () => {
        const { executor, mockAuditoria } = createMockExecutor();
        authService.limpiarIntentosFallidos('operador1');

        // Antes: 2 sesiones activas para operador1
        const activasAntes = executor.state.sessions.filter(s => s.usuario_username === 'operador1' && s.isactive).length;
        assert.equal(activasAntes, 2);

        await authService.cambiarContrasenhaUsuario({
            username: 'operador1',
            contrasenhaActual: 'PasswordActual2026**',
            contrasenhaNueva: 'MiNuevaSuperClave2026$$',
            confirmarContrasenha: 'MiNuevaSuperClave2026$$',
            executor,
            auditoria: mockAuditoria
        });

        // Después: 0 sesiones activas para operador1
        const activasDespues = executor.state.sessions.filter(s => s.usuario_username === 'operador1' && s.isactive).length;
        assert.equal(activasDespues, 0);

        // Sesiones de otros usuarios NO se tocan
        const otrasActivas = executor.state.sessions.filter(s => s.usuario_username === 'otro_usuario' && s.isactive).length;
        assert.equal(otrasActivas, 1, 'Las sesiones de otros usuarios no deben ser afectadas');
    });

    await suite.test('12. Inicio de sesión posterior con la nueva contraseña es exitoso', async () => {
        const { executor, mockAuditoria } = createMockExecutor();
        authService.limpiarIntentosFallidos('operador1');

        await authService.cambiarContrasenhaUsuario({
            username: 'operador1',
            contrasenhaActual: 'PasswordActual2026**',
            contrasenhaNueva: 'ClaveRecienCambiada2026!!',
            confirmarContrasenha: 'ClaveRecienCambiada2026!!',
            executor,
            auditoria: mockAuditoria
        });

        const nuevoHash = executor.state.users.operador1.contrasenha;
        assert.equal(bcrypt.compareSync('ClaveRecienCambiada2026!!', nuevoHash), true);
    });

    await suite.test('13. Rechazo de la contraseña anterior después del cambio', async () => {
        const { executor, mockAuditoria } = createMockExecutor();
        authService.limpiarIntentosFallidos('operador1');

        await authService.cambiarContrasenhaUsuario({
            username: 'operador1',
            contrasenhaActual: 'PasswordActual2026**',
            contrasenhaNueva: 'ClaveRecienCambiada2026!!',
            confirmarContrasenha: 'ClaveRecienCambiada2026!!',
            executor,
            auditoria: mockAuditoria
        });

        const nuevoHash = executor.state.users.operador1.contrasenha;
        assert.equal(bcrypt.compareSync('PasswordActual2026**', nuevoHash), false, 'La contraseña antigua debe ser rechazada');
    });

    await suite.test('14. Funcionamiento del token revocado en middleware: rechaza llamadas subsecuentes', async () => {
        const tokenRevocado = jwt.sign(
            {
                username: 'operador1',
                perfil_id: 'OPERADOR',
                session_jti: 'session-revocada-999',
                faregas_flow: 'authenticated'
            },
            JWT_SECRET_TEST,
            { expiresIn: '1h' }
        );

        const realDb = require('../../../config/database');
        const originalQuery = realDb.query;

        // Mock temporal del pool de db para esta prueba
        realDb.query = async (sql, params) => {
            if (sql.includes('FROM fg_usuario WHERE')) {
                return { rowCount: 1, rows: [{ estado: true, perfil_id: 'OPERADOR' }] };
            }
            if (sql.includes('FROM fg_usuario_sesion WHERE')) {
                // Simula sesión encontrada pero ya inactiva / revocada
                return { rowCount: 1, rows: [{ isactive: false }] };
            }
            return { rowCount: 0, rows: [] };
        };

        try {
            const req = {
                headers: { authorization: `Bearer ${tokenRevocado}` }
            };
            let status = null;
            let response = null;
            const res = {
                status(c) { status = c; return this; },
                json(d) { response = d; return this; }
            };
            let nextCalled = false;
            const next = () => { nextCalled = true; };

            await authFaregasMiddleware(req, res, next);
            assert.equal(nextCalled, false, 'No debe llamar a next()');
            assert.equal(status, 401, 'Debe devolver HTTP 401');
            assert.equal(response.message, 'Sesión revocada o inactiva');
        } finally {
            realDb.query = originalQuery;
        }
    });

    await suite.test('15. Ausencia total de modificaciones en usuario de FARENET', async () => {
        const { executor, mockAuditoria } = createMockExecutor();
        authService.limpiarIntentosFallidos('operador1');

        await authService.cambiarContrasenhaUsuario({
            username: 'operador1',
            contrasenhaActual: 'PasswordActual2026**',
            contrasenhaNueva: 'ClaveSuperSegura2026$$',
            confirmarContrasenha: 'ClaveSuperSegura2026$$',
            executor,
            auditoria: mockAuditoria
        });

        // Verificar todas las consultas SQL emitidas
        for (const q of executor.state.queries) {
            const sql = q.sql.toLowerCase();
            // NUNCA debe tocar 'usuario ' sin prefijo 'fg_'
            assert.doesNotMatch(sql, /\bupdate\s+usuario\b/, 'No debe actualizar tabla usuario de FARENET');
            assert.doesNotMatch(sql, /\binsert\s+into\s+usuario\b/, 'No debe insertar en tabla usuario de FARENET');
            assert.doesNotMatch(sql, /\bdelete\s+from\s+usuario\b/, 'No debe borrar en tabla usuario de FARENET');
            // Las únicas escrituras permitidas son fg_usuario, fg_usuario_sesion y fg_auditoria_acceso
            if (sql.includes('update') || sql.includes('insert') || sql.includes('delete')) {
                assert.match(sql, /fg_usuario|fg_usuario_sesion|fg_auditoria_acceso/, 'Solo debe escribir en tablas fg_*');
            }
        }
    });

    // Cerrar pool o salir cleanly
    setTimeout(() => {
        process.exit(0);
    }, 100);
});
