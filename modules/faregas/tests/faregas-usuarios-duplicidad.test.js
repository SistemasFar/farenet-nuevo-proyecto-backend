const test = require('node:test');
const assert = require('node:assert/strict');

// Mock db antes de requerir el servicio y controlador
const dbPath = require.resolve('../../../config/database');

let mockQueries = [];
let mockClientQueries = [];
let rollbackCalled = false;
let commitCalled = false;

const mockClient = {
    query: async (sql, params) => {
        mockClientQueries.push({ sql: String(sql).trim(), params });
        if (sql === 'BEGIN') return { rowCount: 0 };
        if (sql === 'COMMIT') { commitCalled = true; return { rowCount: 0 }; }
        if (sql === 'ROLLBACK') { rollbackCalled = true; return { rowCount: 0 }; }

        // Mock perfilRepository.estaDisponible
        if (sql.includes('to_regclass')) {
            return { rowCount: 1, rows: [{ disponible: true }] };
        }

        // Mock uExistente check en crearUsuario
        if (sql.includes('SELECT username, estado FROM fg_usuario WHERE LOWER(TRIM(username))')) {
            const username = params[0];
            if (username === 'wdonayre') {
                return { rowCount: 1, rows: [{ username: 'wdonayre', estado: false }] };
            }
            if (username === 'usuario_activo') {
                return { rowCount: 1, rows: [{ username: 'usuario_activo', estado: true }] };
            }
            return { rowCount: 0, rows: [] };
        }

        // Mock docExistente check en crearUsuario
        if (sql.includes('SELECT usuario_username FROM fg_usuario_perfil') && sql.includes('tipo_documento_key = $1 AND nro_documento = $2')) {
            const [tipoKey, nroDoc] = params;
            if (nroDoc === '41716773') {
                return { rowCount: 1, rows: [{ usuario_username: 'wdonayre' }] };
            }
            if (nroDoc === '99999999') {
                return { rowCount: 1, rows: [{ usuario_username: 'otro_usuario' }] };
            }
            return { rowCount: 0, rows: [] };
        }

        if (sql.includes('INSERT INTO fg_usuario (')) return { rowCount: 1, rows: [{ username: params[0] }] };

        // Simular fallo en sedes para probar rollback
        if (sql.includes('fg_perfil_planta') && params[0] === 'FALLA_SEDE') {
            return { rowCount: 0, rows: [] }; // planta no permitida
        }

        return { rowCount: 1, rows: [] };
    },
    release: () => {},
};

require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: {
        connect: async () => mockClient,
        query: async (sql, params) => {
            mockQueries.push({ sql: String(sql).trim(), params });
            // Mock perfilRepository.estaDisponible
            if (sql.includes('to_regclass')) {
                return { rowCount: 1, rows: [{ disponible: true }] };
            }
            return { rowCount: 0, rows: [] };
        },
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

test('crearUsuario rechaza usuario existente inactivo con mensaje específico y código USUARIO_DUPLICADO_INACTIVO', async () => {
    mockClientQueries = [];
    rollbackCalled = false;
    commitCalled = false;

    await assert.rejects(
        async () => {
            await service.crearUsuario({
                username: 'wdonayre',
                perfil_id: 'CONTADOR',
                password: 'Password123#',
                confirmPassword: 'Password123#',
                tipoDocumentoKey: 'dni',
                nroDocumento: '41716773',
                nombres: 'WILBER',
                apellidos: 'DONAYRE',
                email: 'wdonayre@faregas.pe',
                telefono: '922214287',
                paisKey: '1',
                departamentoKey: '15',
                provinciaKey: '121',
                distritoKey: '23',
                direccion: 'SURCO'
            });
        },
        (err) => {
            assert.equal(err.code, 'USUARIO_DUPLICADO_INACTIVO');
            assert.equal(err.message, 'El usuario wdonayre ya existe y está inactivo. Búscalo en el filtro Inactivos para editarlo o reactivarlo.');
            return true;
        }
    );
    assert.equal(rollbackCalled, true);
    assert.equal(commitCalled, false);
});

test('crearUsuario rechaza usuario existente activo con mensaje específico y código USUARIO_DUPLICADO_ACTIVO', async () => {
    mockClientQueries = [];
    rollbackCalled = false;
    commitCalled = false;

    await assert.rejects(
        async () => {
            await service.crearUsuario({
                username: 'usuario_activo',
                perfil_id: 'CONTADOR',
                password: 'Password123#',
                confirmPassword: 'Password123#',
                tipoDocumentoKey: 'dni',
                nroDocumento: '12345678',
                nombres: 'PRUEBA',
                apellidos: 'ACTIVO',
                email: 'activo@faregas.pe',
                telefono: '999888777',
                paisKey: '1',
                departamentoKey: '15',
                provinciaKey: '121',
                distritoKey: '23',
                direccion: 'AV. LIMA 123'
            });
        },
        (err) => {
            assert.equal(err.code, 'USUARIO_DUPLICADO_ACTIVO');
            assert.equal(err.message, 'El usuario usuario_activo ya existe y se encuentra activo. Utilice otro nombre de usuario o edite la cuenta existente.');
            return true;
        }
    );
    assert.equal(rollbackCalled, true);
    assert.equal(commitCalled, false);
});

test('crearUsuario rechaza documento duplicado perteneciente a otro usuario con DOCUMENTO_DUPLICADO', async () => {
    mockClientQueries = [];
    rollbackCalled = false;
    commitCalled = false;

    await assert.rejects(
        async () => {
            await service.crearUsuario({
                username: 'nuevo_usuario',
                perfil_id: 'CONTADOR',
                password: 'Password123#',
                confirmPassword: 'Password123#',
                tipoDocumentoKey: 'dni',
                nroDocumento: '99999999', // Asignado a otro_usuario
                nombres: 'NUEVO',
                apellidos: 'USUARIO',
                email: 'nuevo@faregas.pe',
                telefono: '999888777',
                paisKey: '1',
                departamentoKey: '15',
                provinciaKey: '121',
                distritoKey: '23',
                direccion: 'AV. LIMA 123'
            });
        },
        (err) => {
            assert.equal(err.code, 'DOCUMENTO_DUPLICADO');
            assert.equal(err.message, 'El número de documento 99999999 ya está registrado para otro usuario. Verifique los datos ingresados.');
            return true;
        }
    );
    assert.equal(rollbackCalled, true);
    assert.equal(commitCalled, false);
});

test('controller.crearUsuario responde 409 con mensaje y codigo claros al duplicar usuario inactivo', async () => {
    const res = crearRespuesta();
    const req = {
        body: {
            username: 'wdonayre',
            perfil_id: 'CONTADOR',
            password: 'Password123#',
            confirmPassword: 'Password123#',
            tipoDocumentoKey: 'dni',
            nroDocumento: '41716773',
            nombres: 'WILBER',
            apellidos: 'DONAYRE',
            email: 'wdonayre@faregas.pe',
            telefono: '922214287',
            paisKey: '1',
            departamentoKey: '15',
            provinciaKey: '121',
            distritoKey: '23',
            direccion: 'SURCO'
        },
        user: { username: 'admin' },
    };

    await controller.crearUsuario(req, res);

    assert.equal(res.statusCode, 409);
    assert.equal(res.body.codigo, 'USUARIO_DUPLICADO_INACTIVO');
    assert.equal(res.body.message, 'El usuario wdonayre ya existe y está inactivo. Búscalo en el filtro Inactivos para editarlo o reactivarlo.');
});

test('atomicidad en crearUsuario: si falla asignación de sedes se ejecuta ROLLBACK y no se persisten cambios', async () => {
    mockClientQueries = [];
    rollbackCalled = false;
    commitCalled = false;

    await assert.rejects(
        async () => {
            await service.crearUsuario({
                username: 'usuario_rollback',
                perfil_id: 'FALLA_SEDE',
                sedes: ['SEDE_INEXISTENTE'],
                password: 'Password123#',
                confirmPassword: 'Password123#',
                tipoDocumentoKey: 'dni',
                nroDocumento: '87654321',
                nombres: 'PRUEBA',
                apellidos: 'ROLLBACK',
                email: 'rollback@faregas.pe',
                telefono: '999888777',
                paisKey: '1',
                departamentoKey: '15',
                provinciaKey: '121',
                distritoKey: '23',
                direccion: 'AV. LIMA 123'
            });
        },
        (err) => {
            assert.equal(err.code, 'SEDE_NO_PERMITIDA_PARA_PERFIL');
            return true;
        }
    );

    assert.equal(rollbackCalled, true);
    assert.equal(commitCalled, false);
});
