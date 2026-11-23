const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

const JWT_SECRET = 'test_secret_faregas_logout_1234567890';
process.env.JWT_SECRET_FAREGAS = JWT_SECRET;

const authService = require('../services/faregas-auth.service');
const { authFaregasMiddleware } = require('../middlewares/faregas-auth.middleware');
const authController = require('../controllers/faregas-auth.controller');

test('Logout & Revocación: revocarSesionPorJti actualiza la sesión a isactive = false con timestamps UTC', async () => {
    const mockDb = {
        queries: [],
        query: async (sql, params) => {
            mockDb.queries.push({ sql, params });
            if (sql.includes('UPDATE fg_usuario_sesion') && sql.includes('SET isactive = false')) {
                return {
                    rowCount: 1,
                    rows: [{ id: 42, usuario_username: params[1], planta_key: 'PL-01' }]
                };
            }
            return { rowCount: 0, rows: [] };
        }
    };

    const res = await authService.revocarSesionPorJti('jti-uuid-1234', 'operador1', mockDb);
    assert.ok(res, 'Debe devolver la fila revocada');
    assert.equal(res.id, 42);
    assert.equal(res.usuario_username, 'operador1');

    const updateQuery = mockDb.queries.find(q => q.sql.includes('UPDATE fg_usuario_sesion'));
    assert.ok(updateQuery, 'Debe ejecutar UPDATE en fg_usuario_sesion');
    assert.match(updateQuery.sql, /isactive\s*=\s*false/i);
    assert.match(updateQuery.sql, /revoked_at_utc/i);
    assert.match(updateQuery.sql, /logouttime_utc/i);
    assert.deepEqual(updateQuery.params, ['jti-uuid-1234', 'operador1']);
});

test('Logout & Revocación: middleware rechaza con 401 un token con sesión revocada (isactive = false)', async () => {
    const token = jwt.sign(
        {
            username: 'cajero_norte',
            perfil_id: 'CAJERO',
            session_jti: 'jti-revocado-999',
            planta_key: 'PL-02',
            faregas_flow: 'authenticated'
        },
        JWT_SECRET,
        { expiresIn: '1h' }
    );

    const mockReq = {
        headers: { authorization: `Bearer ${token}` }
    };

    let statusCode = null;
    let jsonResponse = null;
    const mockRes = {
        status: (code) => {
            statusCode = code;
            return {
                json: (data) => { jsonResponse = data; }
            };
        }
    };

    // Mock db en middleware
    const db = require('../../../config/database');
    const origQuery = db.query;
    db.query = async (sql, params) => {
        if (sql.includes('FROM fg_usuario WHERE username')) {
            return { rowCount: 1, rows: [{ estado: true, perfil_id: 'CAJERO' }] };
        }
        if (sql.includes('FROM fg_usuario_sesion WHERE session_jti')) {
            // Sesión inactiva / revocada
            return { rowCount: 1, rows: [{ isactive: false }] };
        }
        return { rowCount: 0, rows: [] };
    };

    try {
        let nextCalled = false;
        await authFaregasMiddleware(mockReq, mockRes, () => { nextCalled = true; });

        assert.equal(nextCalled, false, 'No debe llamar a next() con sesión revocada');
        assert.equal(statusCode, 401);
        assert.match(jsonResponse.message, /revocada o inactiva/i);
    } finally {
        db.query = origQuery;
    }
});

test('Logout & Revocación: middleware permite acceso con sesión activa (isactive = true)', async () => {
    const token = jwt.sign(
        {
            username: 'operador_activo',
            perfil_id: 'OPERADOR',
            session_jti: 'jti-activo-111',
            planta_key: 'PL-01',
            faregas_flow: 'authenticated'
        },
        JWT_SECRET,
        { expiresIn: '1h' }
    );

    const mockReq = {
        headers: { authorization: `Bearer ${token}` }
    };

    const mockRes = {
        status: () => ({ json: () => {} })
    };

    const db = require('../../../config/database');
    const origQuery = db.query;
    db.query = async (sql, params) => {
        if (sql.includes('FROM fg_usuario WHERE username')) {
            return { rowCount: 1, rows: [{ estado: true, perfil_id: 'OPERADOR' }] };
        }
        if (sql.includes('FROM fg_usuario_sesion WHERE session_jti')) {
            return { rowCount: 1, rows: [{ isactive: true }] };
        }
        return { rowCount: 0, rows: [] };
    };

    try {
        let nextCalled = false;
        await authFaregasMiddleware(mockReq, mockRes, () => { nextCalled = true; });

        assert.equal(nextCalled, true, 'Debe invocar next() cuando la sesión está activa');
        assert.ok(mockReq.user, 'Debe adjuntar el token decodificado a req.user');
        assert.equal(mockReq.user.username, 'operador_activo');
    } finally {
        db.query = origQuery;
    }
});

test('Logout & Revocación: controller.logout revoca sesión, registra auditoría y responde 200', async () => {
    const mockReq = {
        user: {
            username: 'juan_perez',
            session_jti: 'jti-logout-777',
            planta_key: 'PL-LIMA'
        },
        headers: {
            'user-agent': 'Mozilla/5.0 Edge/120',
            'x-forwarded-for': '192.168.1.100'
        }
    };

    let statusCode = null;
    let jsonResponse = null;
    const mockRes = {
        status: (code) => {
            statusCode = code;
            return {
                json: (data) => { jsonResponse = data; }
            };
        }
    };

    const db = require('../../../config/database');
    const origQuery = db.query;
    const queries = [];
    db.query = async (sql, params) => {
        queries.push({ sql, params });
        if (sql.includes('UPDATE fg_usuario_sesion')) {
            return { rowCount: 1, rows: [{ id: 88, usuario_username: 'juan_perez', planta_key: 'PL-LIMA' }] };
        }
        if (sql.includes('INSERT INTO fg_auditoria_config')) {
            return { rowCount: 1, rows: [{ id: 101 }] };
        }
        return { rowCount: 0, rows: [] };
    };

    try {
        await authController.logout(mockReq, mockRes);

        assert.equal(statusCode, 200);
        assert.equal(jsonResponse.status, 'success');
        assert.match(jsonResponse.message, /Sesión cerrada y revocada correctamente/i);

        const updateSesion = queries.find(q => q.sql.includes('UPDATE fg_usuario_sesion'));
        assert.ok(updateSesion, 'Debe actualizar fg_usuario_sesion');
        assert.deepEqual(updateSesion.params, ['jti-logout-777', 'juan_perez']);

        const auditQuery = queries.find(q => q.sql.includes('fg_auditoria_config') || q.sql.includes('INSERT'));
        assert.ok(auditQuery, 'Debe registrar evento de auditoría de logout');
    } finally {
        db.query = origQuery;
    }
});

test('Logout & Revocación: usuario desactivado es bloqueado con 403 independientemente del estado de sesión', async () => {
    const token = jwt.sign(
        {
            username: 'usuario_bloqueado',
            perfil_id: 'OPERADOR',
            session_jti: 'jti-bloqueado',
            faregas_flow: 'authenticated'
        },
        JWT_SECRET,
        { expiresIn: '1h' }
    );

    const mockReq = { headers: { authorization: `Bearer ${token}` } };
    let statusCode = null;
    let jsonResponse = null;
    const mockRes = {
        status: (code) => {
            statusCode = code;
            return { json: (data) => { jsonResponse = data; } };
        }
    };

    const db = require('../../../config/database');
    const origQuery = db.query;
    db.query = async (sql) => {
        if (sql.includes('FROM fg_usuario WHERE username')) {
            return { rowCount: 1, rows: [{ estado: false, perfil_id: 'OPERADOR' }] };
        }
        return { rowCount: 0, rows: [] };
    };

    try {
        let nextCalled = false;
        await authFaregasMiddleware(mockReq, mockRes, () => { nextCalled = true; });

        assert.equal(nextCalled, false);
        assert.equal(statusCode, 403);
        assert.match(jsonResponse.message, /Usuario inactivo/i);
    } finally {
        db.query = origQuery;
    }
});

test('cleanup pool', async () => {
    const db = require('../../../config/database');
    if (db && typeof db.end === 'function') {
        await db.end().catch(() => {});
    }
});
