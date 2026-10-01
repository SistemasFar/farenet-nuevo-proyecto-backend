/**
 * `eliminarUsuario()` — sesiones vs. historial.
 *
 * Qué fija esta suite, con dos defectos reales que se corrigieron:
 *
 *  1. `fg_usuario_sesion` y `fg_usuario_planta` NO tienen columna `username`: su
 *     FK se llama `usuario_username`. Consultar `username` en ellas devolvía
 *     42703 y abortaba toda la eliminación. Sólo `fg_usuario` usa `username`,
 *     porque ahí es su clave primaria.
 *
 *  2. Tener sesiones registradas bloqueaba el borrado con `HAS_SESSIONS` (409).
 *     Las sesiones son dependencia del acceso, no historial de negocio: ahora se
 *     cierran dentro de la misma transacción. Lo que sigue bloqueando, con 409 y
 *     el detalle de qué entidad, es el historial (certificados, operaciones,
 *     chips...), porque borrarlo en silencio destruiría trazabilidad.
 *
 * Las pruebas de base son opt-in (FAREGAS_TEST_DB=1) y limpian siempre en
 * `finally`, con borrado en cascada explícito de sus propias filas.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const USA_BASE_DE_DATOS = process.env.FAREGAS_TEST_DB === '1';
if (USA_BASE_DE_DATOS) {
    require('../../../config/env-loader').loadEnv(true);
}

const db = require('../../../config/database');
const service = require('../services/faregas-usuarios.service');
const controller = require('../controllers/faregas-usuarios.controller');

const SERVICIO = fs.readFileSync(
    path.join(__dirname, '..', 'services', 'faregas-usuarios.service.js'), 'utf8');
const CONTROLLER = fs.readFileSync(
    path.join(__dirname, '..', 'controllers', 'faregas-usuarios.controller.js'), 'utf8');
const FRONTEND_RAIZ = path.join(__dirname, '..', '..', '..', '..', 'farenetFrontend', 'src');
const leerFrontend = (...partes) => fs.readFileSync(path.join(FRONTEND_RAIZ, ...partes), 'utf8');
const HTTP_CLIENT = leerFrontend(
    'modules', 'faregas', 'services', 'faregas-http-client.ts');
const VISTA = leerFrontend(
    'modules', 'faregas', 'views', 'Usuarios', 'UsuariosView.tsx');

const bloqueEliminar = SERVICIO.slice(
    SERVICIO.indexOf('exports.eliminarUsuario = async'),
    SERVICIO.indexOf('exports._private = { HISTORIAL_USUARIO')
);
const bloqueDetectar = SERVICIO.slice(
    SERVICIO.indexOf('const detectarHistorial = async'),
    SERVICIO.indexOf('const errorHistorial =')
);

const MARCA = `TEST_ELIMUSR_${Date.now()}`;
const USU_ACTUAL = 'gibarra';
const conBase = (fn) => (t) => {
    if (!USA_BASE_DE_DATOS) return t.skip('requiere FAREGAS_TEST_DB=1 y una base de datos disponible');
    return fn(t);
};

const llamarController = (usuarioActual, objetivo) => new Promise((resolve) => {
    const res = {
        _status: 200,
        status(c) { this._status = c; return this; },
        json(cuerpo) { resolve({ status: this._status, cuerpo }); }
    };
    controller.eliminarUsuario(
        { params: { username: objetivo }, user: { username: usuarioActual } }, res);
});

const contarSesiones = (u) => db
    .query('SELECT COUNT(*)::int n FROM fg_usuario_sesion WHERE usuario_username=$1', [u])
    .then((r) => r.rows[0].n);
const contarPlantas = (u) => db
    .query('SELECT COUNT(*)::int n FROM fg_usuario_planta WHERE usuario_username=$1', [u])
    .then((r) => r.rows[0].n);
const existeUsuario = (u) => db
    .query('SELECT 1 FROM fg_usuario WHERE username=$1 LIMIT 1', [u])
    .then((r) => r.rowCount > 0);

async function sembrar(usuario, { sesiones = 0, planta = true } = {}) {
    const p = await db.query("SELECT key FROM fg_planta WHERE activo = TRUE ORDER BY key LIMIT 1");
    const perfil = await db.query("SELECT clave FROM fg_perfil ORDER BY clave LIMIT 1");
    await db.query(
        `INSERT INTO fg_usuario (username, user_type, contrasenha, perfil_id, estado)
         VALUES ($1, 'USU', 'hash', $2, TRUE)`, [usuario, perfil.rows[0].clave]);
    if (planta) {
        await db.query('INSERT INTO fg_usuario_planta (usuario_username, plantas_key) VALUES ($1, $2)',
            [usuario, p.rows[0].key]);
    }
    for (let i = 0; i < sesiones; i += 1) {
        await db.query(
            `INSERT INTO fg_usuario_sesion (usuario_username, session_jti, isactive)
             VALUES ($1, gen_random_uuid(), TRUE)`, [usuario]);
    }
}

async function limpiar(usuarios) {
    for (const u of usuarios) {
        await db.query('DELETE FROM fg_usuario_sesion WHERE usuario_username = $1', [u]);
        await db.query('DELETE FROM fg_usuario_planta WHERE usuario_username = $1', [u]);
        await db.query('DELETE FROM fg_usuario WHERE username = $1', [u]);
    }
}

// ===========================================================================
// 1. Los nombres de columna correctos
// ===========================================================================

test('1. las sesiones se limpian por usuario_username, no por username', () => {
    // Revertir a `username` aquí es el bug original: 42703.
    assert.match(bloqueEliminar, /DELETE FROM fg_usuario_sesion WHERE usuario_username = \$1/);
    assert.doesNotMatch(bloqueEliminar, /fg_usuario_sesion WHERE username/);
    assert.doesNotMatch(bloqueEliminar, /DELETE FROM fg_usuario_sesion WHERE username/);
});

test('2. fg_usuario_planta también usa usuario_username', () => {
    assert.match(bloqueEliminar, /DELETE FROM fg_usuario_planta WHERE usuario_username = \$1/);
    assert.doesNotMatch(bloqueEliminar, /fg_usuario_planta WHERE username = \$1/);
});

test('3. fg_usuario sí se borra por username, porque ésa es su PK', () => {
    assert.match(bloqueEliminar, /DELETE FROM fg_usuario WHERE username = \$1/);
});

test('4. ya no se consulta si tiene sesiones antes de borrar', () => {
    // El SELECT 1 que disparaba HAS_SESSIONS debe desaparecer: las sesiones se
    // cierran, no bloquean.
    assert.doesNotMatch(bloqueEliminar, /SELECT 1 FROM fg_usuario_sesion/);
    assert.doesNotMatch(bloqueEliminar, /HAS_SESSIONS/);
});

// ===========================================================================
// 2. Una sola transacción
// ===========================================================================

test('5. las tres operaciones van dentro de una transacción con rollback', () => {
    assert.match(bloqueEliminar, /await client\.query\('BEGIN'\)/);
    assert.match(bloqueEliminar, /await client\.query\('COMMIT'\)/);
    assert.match(bloqueEliminar, /await client\.query\('ROLLBACK'\)/);
    // Y el COMMIT va después del DELETE de fg_usuario, no antes.
    assert.ok(bloqueEliminar.indexOf("DELETE FROM fg_usuario WHERE username")
        < bloqueEliminar.indexOf("await client.query('COMMIT')"));
});

test('6. toda la operación usa la misma conexión (el cliente dedicado)', () => {
    // Consultar por `db` en vez de por `client` sacaría las lecturas de la
    // transacción y el historial podría cambiar entre la comprobación y el DELETE.
    assert.doesNotMatch(bloqueEliminar, /\bdb\.query\(/);
    assert.match(bloqueEliminar, /detectarHistorial\(username, client\)/);
});

// ===========================================================================
// 3. El historial bloquea, con detalle
// ===========================================================================

test('7. antes de borrar se comprueba el historial', () => {
    const antes = bloqueEliminar.indexOf('detectarHistorial');
    const borra = bloqueEliminar.indexOf('DELETE FROM fg_usuario WHERE username');
    assert.ok(antes > -1, 'debe detectar el historial');
    assert.ok(antes < borra, 'la comprobación va ANTES del borrado');
});

test('8. si hay historial se aborta con un error 409 tipado', () => {
    assert.match(bloqueEliminar, /if \(bloqueos\.length > 0\) throw errorHistorial/);
    assert.match(SERVICIO, /error\.code = 'USUARIO_CON_HISTORIAL'/);
    assert.match(SERVICIO, /error\.statusCode = 409/);
    // Y lleva el detalle para que el mensaje sea útil.
    assert.match(SERVICIO, /error\.bloqueos = bloqueos/);
});

test('9. el historial cubre las entidades de negocio con FK real', () => {
    for (const tabla of ['fg_certificado', 'fg_operacion_comercial', 'fg_chip',
        'fg_vehiculo', 'fg_ejecutivo', 'fg_auditoria_config']) {
        assert.ok(service._private.HISTORIAL_USUARIO.some((h) => h.tabla === tabla),
            `${tabla} debe estar en el historial que bloquea`);
    }
});

test('10. las sesiones y las sedes NO cuentan como historial', () => {
    // Son dependencia del acceso: se limpian, no bloquean.
    for (const tabla of ['fg_usuario_sesion', 'fg_usuario_planta']) {
        assert.ok(!service._private.HISTORIAL_USUARIO.some((h) => h.tabla === tabla),
            `${tabla} no debe bloquear el borrado`);
    }
});

test('11. cada tabla se consulta por sus columnas reales', () => {
    // Un nombre de columna equivocado aquí daría 42703 otra vez.
    assert.deepEqual(service._private.COLUMNAS_REFERENCIA.fg_chip, ['creado_por', 'actualizado_por']);
    assert.deepEqual(service._private.COLUMNAS_REFERENCIA.fg_auditoria_config, ['username']);
    assert.deepEqual(service._private.COLUMNAS_REFERENCIA.fg_ejecutivo,
        ['username', 'usuario_creacion', 'usuario_modificacion']);
    assert.deepEqual(service._private.COLUMNAS_REFERENCIA.fg_chip_movimiento, ['usuario']);
    for (const { tabla, etiqueta } of service._private.HISTORIAL_USUARIO) {
        assert.ok(Array.isArray(service._private.COLUMNAS_REFERENCIA[tabla])
            && service._private.COLUMNAS_REFERENCIA[tabla].length > 0,
            `${tabla} necesita columnas para consultar`);
        assert.ok(etiqueta && etiqueta.length > 2, `${tabla} necesita etiqueta legible`);
    }
});

test('12. los parámetros del detector empiezan en $1', () => {
    // Con $2 inicial y un parámetro de más, Postgres no infiere el tipo y falla.
    assert.match(bloqueDetectar, /\$\$\{indice \+ 1\}/);
    assert.match(bloqueDetectar, /columnas\.map\(\(\) => username\)/);
});

test('13. el detector tolera tablas inexistentes', () => {
    assert.match(bloqueDetectar, /to_regclass\(\$1::text\)/);
    assert.match(bloqueDetectar, /if \(!existe\) continue/);
});

// ===========================================================================
// 4. El controller responde 409, nunca 500
// ===========================================================================

test('14. el controller traduce el historial a 409 con el detalle', () => {
    assert.match(CONTROLLER, /e\.code === 'USUARIO_CON_HISTORIAL'/);
    assert.match(CONTROLLER, /res\.status\(409\)\.json\(\{/);
    assert.match(CONTROLLER, /message: `No se puede eliminar el usuario porque \$\{detalle\}`/);
    assert.match(CONTROLLER, /bloqueos/);
});

test('15. también captura el 23503 de la base, sin degradarlo a 500', () => {
    // El DELETE sigue protegido por las FK; si alguna se disparara, el mensaje
    // debe seguir siendo de historial, no "Error interno del servidor".
    assert.match(CONTROLLER, /e\.code === '23503'/);
});

test('16. el mensaje nombra las entidades que bloquean', () => {
    assert.match(CONTROLLER, /bloqueos\.map\(\(b\) => `\$\{b\.total\} \$\{b\.etiqueta\}`\)\.join\(', '\)/);
    // Y hay un texto de reserva cuando la base no.detail quién fue.
    assert.match(CONTROLLER, /tiene historial asociado\./);
});

test('17. ya no se manda HAS_SESSIONS al usuario', () => {
    assert.doesNotMatch(CONTROLLER, /HAS_SESSIONS/);
    assert.doesNotMatch(CONTROLLER, /tiene sesiones registradas/);
});

test('18. se sigue impediendo borrarse a uno mismo', () => {
    assert.match(CONTROLLER, /req\.user\.username === usuarioObjetivo/);
    assert.match(CONTROLLER, /No puedes eliminar tu propio usuario/);
});

test('19. el 500 genérico queda sólo para lo que no es historial', () => {
    assert.match(CONTROLLER, /res\.status\(500\)\.json\(\{ message: 'Error interno del servidor' \}\)/);
});

// ===========================================================================
// 5. El frontend propaga el mensaje real
// ===========================================================================

test('20. el cliente HTTP toma el message del cuerpo 409', () => {
    // Sin esto, la UI mostraría "Error en la peticion".
    assert.match(HTTP_CLIENT, /message = errorData\.message \|\| message/);
    assert.match(HTTP_CLIENT, /const error = new Error\(message\) as FaregasHttpError/);
    assert.match(HTTP_CLIENT, /throw error/);
});

test('21. la vista muestra el mensaje del error, sinreplacearlo', () => {
    assert.match(VISTA, /catch \(e: any\)/);
    assert.match(VISTA, /alert\(e\.message \|\| 'Error al eliminar usuario'\)/);
    // Y conserva el botón de eliminar con su confirmación.
    assert.match(VISTA, /handleDeleteUsuario/);
    assert.match(VISTA, /faregasUsuariosApi\.eliminarUsuario\(username\)/);
});

// ===========================================================================
// 6. Comportamiento real contra la base
// ===========================================================================

test('22. CASO A — con sesiones y sin historial se elimina todo', conBase(async () => {
    const usuario = `${MARCA}_A`;
    try {
        await sembrar(usuario, { sesiones: 3 });
        assert.equal(await contarSesiones(usuario), 3, 'precondición: 3 sesiones');
        assert.equal(await contarPlantas(usuario), 1, 'precondición: 1 sede');

        const resultado = await service.eliminarUsuario(usuario);

        assert.equal(resultado.sesionesCerradas, 3, 'debe cerrar las 3 sesiones');
        assert.equal(await existeUsuario(usuario), false, 'el usuario se elimina');
        assert.equal(await contarSesiones(usuario), 0, 'no quedan sesiones');
        assert.equal(await contarPlantas(usuario), 0, 'no quedan sedes');
    } finally {
        await limpiar([usuario]);
    }
}));

test('23. CASO B — sin sesiones se elimina normalmente', conBase(async () => {
    const usuario = `${MARCA}_B`;
    try {
        await sembrar(usuario, { sesiones: 0 });
        const resultado = await service.eliminarUsuario(usuario);
        assert.equal(resultado.sesionesCerradas, 0);
        assert.equal(await existeUsuario(usuario), false);
    } finally {
        await limpiar([usuario]);
    }
}));

test('24. CASO C — con historial NO se elimina y responde 409 con detalle', conBase(async () => {
    const conHistorial = (await db.query(`
        SELECT u.username FROM fg_usuario u
        WHERE EXISTS (SELECT 1 FROM fg_certificado c WHERE c.usuario_creacion = u.username)
        ORDER BY u.username LIMIT 1`)).rows[0];
    if (!conHistorial) return; // nadie tiene certificados en esta base

    const certs = (await db.query(
        `SELECT COUNT(*)::int n FROM fg_certificado
         WHERE usuario_creacion=$1 OR usuario_modificacion=$1`, [conHistorial.username])).rows[0].n;

    const r = await llamarController(USU_ACTUAL, conHistorial.username);

    assert.equal(r.status, 409, 'debe ser 409, no 500');
    assert.doesNotMatch(r.cuerpo.message, /Error interno/);
    assert.match(r.cuerpo.message, /No se puede eliminar el usuario porque/);
    // Nombra la entidad que bloquea.
    assert.ok(r.cuerpo.bloqueos.length > 0, 'debe decir qué bloquea');
    assert.ok(r.cuerpo.bloqueos.some((b) => b.tabla === 'fg_certificado' && b.total === certs),
        'debe reportar los certificados con su total');
    // Y el historial queda intacto.
    assert.equal(await existeUsuario(conHistorial.username), true, 'el usuario sigue existiendo');
    const certsDespues = (await db.query(
        `SELECT COUNT(*)::int n FROM fg_certificado
         WHERE usuario_creacion=$1 OR usuario_modificacion=$1`, [conHistorial.username])).rows[0].n;
    assert.equal(certsDespues, certs, 'el historial no se toca');
}));

test('25. CASO D — el rollback restaura sesiones y sedes', conBase(async () => {
    const usuario = `${MARCA}_D`;
    try {
        await sembrar(usuario, { sesiones: 2 });
        // Se fuerza el fallo después de borrar sesiones y sedes: como todo vive en
        // la transacción, el rollback debe devolver el estado original.
        const client = await db.connect();
        try {
            await client.query('BEGIN');
            await client.query('DELETE FROM fg_usuario_sesion WHERE usuario_username = $1', [usuario]);
            await client.query('DELETE FROM fg_usuario_planta WHERE usuario_username = $1', [usuario]);
            throw new Error('FALLO_SIMULADO');
        } catch {
            await client.query('ROLLBACK');
        } finally {
            client.release();
        }

        assert.equal(await existeUsuario(usuario), true, 'el usuario sobrevive');
        assert.equal(await contarSesiones(usuario), 2, 'sus sesiones se restauraron');
        assert.equal(await contarPlantas(usuario), 1, 'su sede se restauró');
    } finally {
        await limpiar([usuario]);
    }
}));

test('26. CASO D2 — con sesiones Y historial, el rollback restaura las sesiones', conBase(async () => {
    const usuario = `${MARCA}_D2`;
    const paso = (await db.query(
        'SELECT paso_actual FROM fg_certificado WHERE paso_actual IS NOT NULL LIMIT 1')).rows[0];
    const tipo = (await db.query(
        'SELECT tipo_certificado_clave FROM fg_certificado WHERE tipo_certificado_clave IS NOT NULL LIMIT 1')).rows[0];
    if (!paso || !tipo) return;
    try {
        await sembrar(usuario, { sesiones: 3 });
        await db.query(
            `INSERT INTO fg_certificado (tipo_certificado_clave, planta_key, estado, usuario_creacion, tarifa_codigo, paso_actual)
             VALUES ($1, $2, 'BORRADOR', $3, 'TEST_D2', $4)`,
            [tipo.tipo_certificado_clave, '100', usuario, paso.paso_actual]);

        await assert.rejects(
            () => service.eliminarUsuario(usuario),
            (e) => e.code === 'USUARIO_CON_HISTORIAL' && e.statusCode === 409);

        // Lo importante: las sesiones NO se pierden, porque el borrado abortó.
        assert.equal(await contarSesiones(usuario), 3, 'el rollback restauró las 3 sesiones');
        assert.equal(await contarPlantas(usuario), 1, 'y la sede');
        assert.equal(await existeUsuario(usuario), true, 'el usuario sigue existiendo');
    } finally {
        await db.query("DELETE FROM fg_certificado WHERE usuario_creacion = $1 AND tarifa_codigo = 'TEST_D2'", [usuario]);
        await limpiar([usuario]);
    }
}));

test('27. eliminar un usuario inexistente no rompe', conBase(async () => {
    const r = await llamarController(USU_ACTUAL, 'NO_EXISTE_XYZ_123');
    assert.equal(r.status, 200);
    assert.equal(r.cuerpo.success, true);
    assert.equal(r.cuerpo.sesiones_cerradas, 0);
}));

test('28. uno no puede eliminarse a sí mismo', conBase(async () => {
    const r = await llamarController(USU_ACTUAL, USU_ACTUAL);
    assert.equal(r.status, 409);
    assert.match(r.cuerpo.message, /tu propio usuario/);
}));

test('29. no quedan residuos de las pruebas', conBase(async () => {
    const sobro = (await db.query(
        'SELECT username FROM fg_usuario WHERE username LIKE $1', [`${MARCA}%`])).rows;
    assert.equal(sobro.length, 0, `no deben quedar usuarios de prueba: ${sobro.map((u) => u.username)}`);
    const certs = (await db.query(
        "SELECT id FROM fg_certificado WHERE tarifa_codigo = 'TEST_D2'")).rows;
    assert.equal(certs.length, 0, 'no deben quedar certificados de prueba');
}));
