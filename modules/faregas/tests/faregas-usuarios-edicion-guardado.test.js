const test = require('node:test');
const assert = require('node:assert/strict');
const service = require('../services/faregas-usuarios.service');
const controller = require('../controllers/faregas-usuarios.controller');

test('actualizarUsuario: actualiza exitosamente datos, sedes, perfil y estado dentro de transaccion', async () => {
    const queries = [];
    const mockClient = {
        query: async (sql, params) => {
            queries.push({ sql: sql.trim(), params });
            if (sql.includes('BEGIN')) return { rowCount: 0 };
            if (sql.includes('COMMIT')) return { rowCount: 0 };
            if (sql.includes('ROLLBACK')) return { rowCount: 0 };
            if (sql.includes("to_regclass('public.fg_usuario_perfil')")) {
                return { rowCount: 1, rows: [{ disponible: true }] };
            }
            if (sql.includes('FROM fg_usuario_perfil') && sql.includes('nro_documento = $2')) {
                return { rowCount: 0, rows: [] };
            }
            if (sql.includes('UPDATE fg_usuario')) {
                return { rowCount: 1 };
            }
            if (sql.includes('DELETE FROM fg_usuario_planta')) {
                return { rowCount: 1 };
            }
            if (sql.includes('SELECT 1 FROM fg_perfil_planta')) {
                return { rowCount: 1, rows: [{ ok: 1 }] };
            }
            if (sql.includes('INSERT INTO fg_usuario_planta')) {
                return { rowCount: 1 };
            }
            if (sql.includes('INSERT INTO public.fg_usuario_perfil')) {
                return { rowCount: 1 };
            }
            if (sql.includes('UPDATE fg_ejecutivo')) {
                return { rowCount: 1 };
            }
            return { rowCount: 0, rows: [] };
        },
        release: () => {}
    };

    const originalConnect = service.__db?.connect || require('../../../config/database').connect;
    const db = require('../../../config/database');
    db.connect = async () => mockClient;

    try {
        const payload = {
            username: 'wdonayre',
            tipoDocumentoKey: 'dni',
            nroDocumento: '41716773',
            nombres: 'WILBER ALEXIS',
            apellidos: 'DONAYRE PISCONTE',
            direccion: 'AV SURCO 123',
            email: 'wdonayre@faregas.pe',
            telefono: '922214287',
            paisKey: '1',
            departamentoKey: '15',
            provinciaKey: '121',
            distritoKey: '23',
            perfil_id: 'CONTADOR',
            sedes: ['201', '150'],
            estado: true
        };

        const result = await service.actualizarUsuario('wdonayre', payload);
        assert.equal(result.username, 'wdonayre');

        // Verificar transaccion
        assert(queries.some(q => q.sql === 'BEGIN'), 'Debe iniciar transaccion BEGIN');
        assert(queries.some(q => q.sql === 'COMMIT'), 'Debe confirmar transaccion COMMIT');
        assert(!queries.some(q => q.sql === 'ROLLBACK'), 'No debe haber ROLLBACK');

        // Verificar UPDATE fg_usuario
        const updateUsuario = queries.find(q => q.sql.includes('UPDATE fg_usuario'));
        assert(updateUsuario, 'Debe ejecutar UPDATE fg_usuario');
        assert.equal(updateUsuario.params[0], 'wdonayre');
        assert.equal(updateUsuario.params[1], 'CONTADOR');
        assert.equal(updateUsuario.params[2], true);

        // Verificar asignacion de plantas
        const deletePlantas = queries.find(q => q.sql.includes('DELETE FROM fg_usuario_planta'));
        assert(deletePlantas, 'Debe limpiar plantas anteriores');
        const insertPlantas = queries.filter(q => q.sql.includes('INSERT INTO fg_usuario_planta'));
        assert.equal(insertPlantas.length, 2, 'Debe insertar las 2 sedes');
    } finally {
        db.connect = originalConnect;
    }
});

test('actualizarUsuario: rechaza modificar la cuenta protegida gibarra', async () => {
    const originalConnect = require('../../../config/database').connect;
    const db = require('../../../config/database');
    const mockClient = {
        query: async (sql) => {
            if (sql.includes('BEGIN')) return {};
            if (sql.includes('ROLLBACK')) return {};
            return {};
        },
        release: () => {}
    };
    db.connect = async () => mockClient;

    try {
        await assert.rejects(
            async () => {
                await service.actualizarUsuario('gibarra', {
                    username: 'gibarra',
                    tipoDocumentoKey: 'dni',
                    nroDocumento: '10203040',
                    nombres: 'GUSTAVO',
                    apellidos: 'IBARRA',
                    direccion: 'CALLE PRINCIPAL 123',
                    telefono: '999888777',
                    paisKey: '1',
                    departamentoKey: '15',
                    provinciaKey: '121',
                    distritoKey: '23',
                    perfil_id: 'SISTEMAS',
                    estado: true
                });
            },
            (err) => {
                assert.equal(err.code, 'USUARIO_PROTEGIDO');
                assert(err.message.includes('gibarra es una cuenta administrativa protegida'));
                return true;
            }
        );
    } finally {
        db.connect = originalConnect;
    }
});

test('actualizarUsuario: rechaza sedes no permitidas para el perfil con SEDE_NO_PERMITIDA_PARA_PERFIL y hace ROLLBACK', async () => {
    const queries = [];
    const mockClient = {
        query: async (sql, params) => {
            queries.push({ sql: sql.trim(), params });
            if (sql.includes('BEGIN')) return {};
            if (sql.includes('COMMIT')) return {};
            if (sql.includes('ROLLBACK')) return {};
            if (sql.includes("to_regclass('public.fg_usuario_perfil')")) {
                return { rowCount: 1, rows: [{ disponible: true }] };
            }
            if (sql.includes('UPDATE fg_usuario')) return { rowCount: 1 };
            if (sql.includes('DELETE FROM fg_usuario_planta')) return { rowCount: 1 };
            if (sql.includes('SELECT 1 FROM fg_perfil_planta')) {
                // Simular que la planta no esta permitida para el perfil
                return { rowCount: 0, rows: [] };
            }
            return { rowCount: 0, rows: [] };
        },
        release: () => {}
    };

    const originalConnect = require('../../../config/database').connect;
    const db = require('../../../config/database');
    db.connect = async () => mockClient;

    try {
        await assert.rejects(
            async () => {
                await service.actualizarUsuario('wdonayre', {
                    username: 'wdonayre',
                    tipoDocumentoKey: 'dni',
                    nroDocumento: '41716773',
                    nombres: 'WILBER ALEXIS',
                    apellidos: 'DONAYRE PISCONTE',
                    direccion: 'AV SURCO 123',
                    telefono: '922214287',
                    paisKey: '1',
                    departamentoKey: '15',
                    provinciaKey: '121',
                    distritoKey: '23',
                    perfil_id: 'CONTADOR',
                    sedes: ['999_INVALIDA'],
                    estado: true
                });
            },
            (err) => {
                assert.equal(err.code, 'SEDE_NO_PERMITIDA_PARA_PERFIL');
                assert.equal(err.statusCode, 400);
                assert(err.message.includes('no está permitida'));
                return true;
            }
        );
        assert(queries.some(q => q.sql === 'ROLLBACK'), 'Debe abortar con ROLLBACK');
        assert(!queries.some(q => q.sql === 'COMMIT'), 'No debe hacer COMMIT');
    } finally {
        db.connect = originalConnect;
    }
});

test('actualizarUsuario: desactiva usuario y revoca sesiones en la misma transaccion', async () => {
    const queries = [];
    const mockClient = {
        query: async (sql, params) => {
            queries.push({ sql: sql.trim(), params });
            if (sql.includes('BEGIN')) return {};
            if (sql.includes('COMMIT')) return {};
            if (sql.includes('ROLLBACK')) return {};
            if (sql.includes("to_regclass('public.fg_usuario_perfil')")) {
                return { rowCount: 1, rows: [{ disponible: true }] };
            }
            if (sql.includes('UPDATE fg_usuario')) return { rowCount: 1 };
            if (sql.includes('DELETE FROM fg_usuario_planta')) return { rowCount: 1 };
            if (sql.includes('UPDATE fg_usuario_sesion')) return { rowCount: 2 };
            return { rowCount: 0, rows: [] };
        },
        release: () => {}
    };

    const originalConnect = require('../../../config/database').connect;
    const db = require('../../../config/database');
    db.connect = async () => mockClient;

    try {
        const result = await service.actualizarUsuario('wdonayre', {
            username: 'wdonayre',
            tipoDocumentoKey: 'dni',
            nroDocumento: '41716773',
            nombres: 'WILBER ALEXIS',
            apellidos: 'DONAYRE PISCONTE',
            direccion: 'AV SURCO 123',
            telefono: '922214287',
            paisKey: '1',
            departamentoKey: '15',
            provinciaKey: '121',
            distritoKey: '23',
            perfil_id: 'CONTADOR',
            sedes: [],
            estado: false // Desactivando
        });

        assert.equal(result.username, 'wdonayre');
        const updateUsuario = queries.find(q => q.sql.includes('UPDATE fg_usuario'));
        assert.equal(updateUsuario.params[2], false, 'estadoBool debe ser false');

        const revocarSesiones = queries.find(q => q.sql.includes('UPDATE fg_usuario_sesion'));
        assert(revocarSesiones, 'Debe revocar sesiones activas del usuario desactivado');
        assert(queries.some(q => q.sql === 'COMMIT'), 'Debe confirmar transaccion atómica');
    } finally {
        db.connect = originalConnect;
    }
});

test('controller.actualizarUsuario responde 403 para cuenta protegida y 400 para sede invalida', async () => {
    let statusCode = null;
    let jsonBody = null;
    const res = {
        status: (c) => { statusCode = c; return res; },
        json: (b) => { jsonBody = b; return res; }
    };

    // Caso cuenta protegida gibarra
    const reqGibarra = {
        params: { username: 'gibarra' },
        user: { username: 'admin' },
        body: { username: 'gibarra', estado: true },
        ip: '127.0.0.1',
        headers: {}
    };
    await controller.actualizarUsuario(reqGibarra, res);
    assert.equal(statusCode, 403);
    assert.equal(jsonBody.codigo, 'USUARIO_PROTEGIDO');
});

test('cleanup pool', async () => {
    const db = require('../../../config/database');
    if (db && typeof db.end === 'function') {
        await db.end().catch(() => {});
    }
});
