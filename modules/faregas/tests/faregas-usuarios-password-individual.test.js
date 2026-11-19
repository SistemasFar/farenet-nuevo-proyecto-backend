const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');

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
const dbMock = require(dbPath);

const usuariosService = require('../services/faregas-usuarios.service');
const authService = require('../services/faregas-auth.service');

test('alta manual guarda el hash exacto y permite iniciar sesión con la contraseña introducida', async () => {
    const queries = [];
    let hashGuardado = null;
    const client = {
        query: async (sql, params = []) => {
            const statement = String(sql);
            queries.push({ sql: statement, params });
            if (/to_regclass\('public\.fg_usuario_perfil'\)/i.test(statement)) {
                return { rowCount: 1, rows: [{ disponible: true }] };
            }
            if (/INSERT INTO fg_usuario\s*\(/i.test(statement)) {
                hashGuardado = params[1];
                return { rowCount: 1, rows: [] };
            }
            return { rowCount: 1, rows: [] };
        },
        release: () => {},
    };
    dbMock.connect = async () => client;

    await usuariosService.crearUsuario({
        username: 'usuario_nuevo',
        password: 'ClaveAlta#2026',
        confirmPassword: 'ClaveAlta#2026',
        perfil_id: 'CONTADOR',
        estado: true,
        user_type: 'USER',
        sedes: [],
        tipoDocumentoKey: 'dni',
        nroDocumento: '12345678',
        nombres: 'ANA',
        apellidos: 'PRUEBA',
        nombreRazonSocial: '',
        paisKey: 'PE',
        departamentoKey: '15',
        provinciaKey: '1501',
        distritoKey: '150101',
        direccion: 'AVENIDA PRUEBA 123',
        email: 'ana.prueba@example.pe',
        telefono: '987654321',
    });

    assert.ok(hashGuardado?.startsWith('$2'));
    assert.equal(bcrypt.compareSync('ClaveAlta#2026', hashGuardado), true);
    assert.equal(queries.some(({ sql }) => /(?:INSERT|UPDATE|DELETE)[\s\S]*\bpersona\b/i.test(sql)), false);

    dbMock.query = async (sql) => {
        if (/FROM fg_usuario/i.test(sql)) {
            return {
                rowCount: 1,
                rows: [{
                    username: 'usuario_nuevo',
                    contrasenha: hashGuardado,
                    perfil_id: 'CONTADOR',
                    estado: true,
                    user_type: 'USER',
                }],
            };
        }
        throw new Error('CONSULTA_LOGIN_NO_ESPERADA');
    };
    assert.equal((await authService.validarFaregas('usuario_nuevo', 'ClaveAlta#2026')).valido, true);
    assert.equal((await authService.validarFaregas('usuario_nuevo', 'OtraClave#2026')).valido, false);
});

test('cambio individual guarda bcrypt, invalida la clave anterior y revoca sesiones en la misma transacción', async () => {
    const queries = [];
    let hashGuardado = null;
    let clienteRevocacion = null;
    const client = {
        query: async (sql, params = []) => {
            queries.push({ sql: String(sql), params });
            if (/UPDATE\s+fg_usuario\s+SET\s+contrasenha/i.test(sql)) {
                hashGuardado = params[0];
                return { rowCount: 1, rows: [] };
            }
            return { rowCount: 0, rows: [] };
        },
        release: () => {},
    };
    const authApi = {
        validarPoliticaPassword: authService.validarPoliticaPassword,
        revocarSesionesUsuario: async (_username, executor) => {
            clienteRevocacion = executor;
            await executor.query('UPDATE fg_usuario_sesion SET isactive = false WHERE usuario_username = $1', ['usuario_prueba']);
            return 2;
        },
    };

    const resultado = await usuariosService.cambiarPassword('usuario_prueba', 'ClaveNueva#2026', {
        pool: { connect: async () => client },
        bcryptApi: bcrypt,
        authApi,
    });

    assert.equal(resultado.sesionesRevocadas, 2);
    assert.equal(clienteRevocacion, client);
    assert.equal(bcrypt.compareSync('ClaveNueva#2026', hashGuardado), true);
    assert.equal(bcrypt.compareSync('ClaveAnterior#2026', hashGuardado), false);
    assert.ok(queries.some(({ sql }) => /^BEGIN$/i.test(sql)));
    assert.ok(queries.some(({ sql }) => /^COMMIT$/i.test(sql)));
    assert.equal(queries.some(({ sql }) => /fg_perfil|fg_usuario_planta/i.test(sql)), false);
});

test('rechaza una contraseña insegura antes de abrir conexión o modificar datos', async () => {
    let conecto = false;
    await assert.rejects(
        usuariosService.cambiarPassword('usuario_prueba', '123', {
            pool: { connect: async () => { conecto = true; throw new Error('NO_DEBE_CONECTAR'); } },
            authApi: authService,
        }),
        (error) => error.code === 'POLITICA_PASSWORD_INVALIDA' && error.statusCode === 400,
    );
    assert.equal(conecto, false);
});
