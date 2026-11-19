const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const authService = require('../services/faregas-auth.service');
const {
    restablecerCredencialesTemporales,
} = require('../services/faregas-credenciales-temporales.service');

const generarClaveAislada = (username = '') => {
    for (;;) {
        const password = `Zz7#${crypto.randomBytes(32).toString('base64url')}`;
        if (!password.toLowerCase().includes(username.toLowerCase())) return password;
    }
};

const crearEstado = () => {
    const originales = new Map(['maria', 'luis', 'inactivo', 'otro'].map((username) => (
        [username, generarClaveAislada(username)]
    )));
    return {
    passwordsOriginales: originales,
    users: new Map([
        ['maria', { username: 'maria', estado: true, contrasenha: bcrypt.hashSync(originales.get('maria'), 4) }],
        ['luis', { username: 'luis', estado: true, contrasenha: bcrypt.hashSync(originales.get('luis'), 4) }],
        ['inactivo', { username: 'inactivo', estado: false, contrasenha: bcrypt.hashSync(originales.get('inactivo'), 4) }],
        ['otro', { username: 'otro', estado: true, contrasenha: bcrypt.hashSync(originales.get('otro'), 4) }],
    ]),
    sessions: [
        { usuario_username: 'maria', id: 1, isactive: true },
        { usuario_username: 'maria', id: 2, isactive: true },
        { usuario_username: 'luis', id: 3, isactive: true },
        { usuario_username: 'otro', id: 4, isactive: true },
    ],
    commits: 0,
    rollbacks: 0,
    connects: 0,
    failUsername: null,
    };
};

const crearPool = (state) => ({
    async connect() {
        state.connects += 1;
        let snapshot;
        return {
            async query(sql, params = []) {
                const query = sql.replace(/\s+/g, ' ').trim().toUpperCase();
                if (query === 'BEGIN') {
                    snapshot = {
                        users: new Map([...state.users].map(([key, value]) => [key, { ...value }])),
                        sessions: state.sessions.map((session) => ({ ...session })),
                    };
                    return { rowCount: null, rows: [] };
                }
                if (query === 'COMMIT') {
                    state.commits += 1;
                    return { rowCount: null, rows: [] };
                }
                if (query === 'ROLLBACK') {
                    state.rollbacks += 1;
                    if (snapshot) {
                        state.users = snapshot.users;
                        state.sessions = snapshot.sessions;
                    }
                    return { rowCount: null, rows: [] };
                }
                if (query.startsWith('SELECT USERNAME, ESTADO FROM PUBLIC.FG_USUARIO')) {
                    const selected = new Set(params[0]);
                    const rows = [...state.users.values()]
                        .filter((user) => selected.has(user.username))
                        .sort((a, b) => a.username.localeCompare(b.username));
                    return { rowCount: rows.length, rows };
                }
                if (query.startsWith('UPDATE PUBLIC.FG_USUARIO SET CONTRASENHA')) {
                    const [hash, username] = params;
                    if (username === state.failUsername) throw new Error('simulated update failure');
                    const user = state.users.get(username);
                    if (!user || !user.estado) return { rowCount: 0, rows: [] };
                    state.users.set(username, { ...user, contrasenha: hash });
                    return { rowCount: 1, rows: [] };
                }
                if (query.startsWith('UPDATE FG_USUARIO_SESION')) {
                    const [username] = params;
                    const changed = [];
                    state.sessions = state.sessions.map((session) => {
                        if (session.usuario_username === username && session.isactive) {
                            changed.push(session.id);
                            return { ...session, isactive: false };
                        }
                        return session;
                    });
                    return { rowCount: changed.length, rows: changed.map((id) => ({ id })) };
                }
                if (query.startsWith('INSERT INTO PUBLIC.FG_USUARIO_CREDENCIAL') || query.startsWith('INSERT INTO FG_USUARIO_CREDENCIAL')) {
                    return { rowCount: 1, rows: [] };
                }
                throw new Error(`Unexpected SQL in test: ${query}`);
            },
            release() {},
        };
    },
});

const authApi = {
    validarPoliticaPassword: authService.validarPoliticaPassword,
    revocarSesionesUsuario: authService.revocarSesionesUsuario,
};

test('restablece solo las cuentas seleccionadas, revoca sesiones y devuelve solo identificadores', async () => {
    const state = crearEstado();
    const nuevaMaria = generarClaveAislada('maria');
    const nuevoLuis = generarClaveAislada('luis');
    const result = await restablecerCredencialesTemporales([
        { username: 'maria', password: nuevaMaria },
        { username: 'luis', password: nuevoLuis },
    ], { pool: crearPool(state), authApi });

    assert.deepEqual(result.map((item) => item.username), ['maria', 'luis']);
    assert.equal(JSON.stringify(result).includes('password'), false);
    assert.equal(bcrypt.compareSync(nuevaMaria, state.users.get('maria').contrasenha), true);
    assert.equal(bcrypt.compareSync(nuevoLuis, state.users.get('luis').contrasenha), true);
    assert.equal(bcrypt.compareSync(state.passwordsOriginales.get('maria'), state.users.get('maria').contrasenha), false);
    assert.equal(bcrypt.compareSync(state.passwordsOriginales.get('luis'), state.users.get('luis').contrasenha), false);
    assert.equal(state.sessions.filter((session) => session.usuario_username === 'maria' && session.isactive).length, 0);
    assert.equal(state.sessions.filter((session) => session.usuario_username === 'luis' && session.isactive).length, 0);
    assert.equal(state.sessions.find((session) => session.usuario_username === 'otro').isactive, true);
    assert.equal(state.commits, 1);
    assert.equal(state.rollbacks, 0);
});

test('revierte todo el lote si una de las cuentas está inactiva o no existe', async () => {
    for (const username of ['inactivo', 'no-existe']) {
        const state = crearEstado();
        const nuevoValor = generarClaveAislada('maria');
        const nuevoSegundoValor = generarClaveAislada(username);
        const oldMariaHash = state.users.get('maria').contrasenha;
        await assert.rejects(
            restablecerCredencialesTemporales([
                { username: 'maria', password: nuevoValor },
                { username, password: nuevoSegundoValor },
            ], { pool: crearPool(state), authApi }),
            (error) => error.statusCode === 409,
        );
        assert.equal(state.users.get('maria').contrasenha, oldMariaHash);
        assert.equal(state.commits, 0);
        assert.equal(state.rollbacks, 1);
        assert.equal(state.sessions.filter((session) => session.isactive).length, 4);
    }
});

test('rechaza lotes vacíos, usernames duplicados, contraseñas repetidas o temporales cortas antes de conectar', async () => {
    const password = generarClaveAislada('maria');
    const casos = [
        [],
        [
            { username: 'maria', password: generarClaveAislada('maria') },
            { username: 'maria', password: generarClaveAislada('maria') },
        ],
        [
            { username: 'maria', password },
            { username: 'luis', password },
        ],
        [{ username: 'maria', password: crypto.randomBytes(6).toString('hex') }],
    ];
    for (const credenciales of casos) {
        const state = crearEstado();
        await assert.rejects(restablecerCredencialesTemporales(credenciales, { pool: crearPool(state), authApi }));
        assert.equal(state.connects, 0);
    }
});

test('revierte hash y sesiones si falla una actualización a mitad del lote', async () => {
    const state = crearEstado();
    state.failUsername = 'maria';
    const oldHashes = new Map([...state.users].map(([username, user]) => [username, user.contrasenha]));
    await assert.rejects(restablecerCredencialesTemporales([
        { username: 'maria', password: generarClaveAislada('maria') },
        { username: 'luis', password: generarClaveAislada('luis') },
    ], { pool: crearPool(state), authApi }));
    for (const [username, hash] of oldHashes) assert.equal(state.users.get(username).contrasenha, hash);
    assert.equal(state.sessions.filter((session) => session.isactive).length, 4);
    assert.equal(state.commits, 0);
    assert.equal(state.rollbacks, 1);
});
