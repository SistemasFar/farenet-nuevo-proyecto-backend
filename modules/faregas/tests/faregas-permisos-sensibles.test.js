const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const servicio = require('../services/faregas-permisos-sensibles.service');
const usuariosService = require('../services/faregas-usuarios.service');
const {
    FAREGAS_PERMISO_ADMINISTRAR_PERFILES,
    PERMISOS_SENSIBLES
} = require('../services/faregas-permisos-sensibles.constants');

const crearExecutor = ({
    actuales = [],
    actor = { username: 'admin', perfil_id: 'JEFE_PLANTA', estado: true },
    permisosActor = [FAREGAS_PERMISO_ADMINISTRAR_PERFILES],
    catalogo = [
        'MENU_INICIO',
        'MENU_USUARIOS',
        'FAREGAS_SOLICITUD_CREAR',
        'FAREGAS_SOLICITUD_VER',
        ...PERMISOS_SENSIBLES
    ],
    disponibles = PERMISOS_SENSIBLES,
    catalogoReal = null,
    existentes = []
} = {}) => {
    const llamadas = [];
    const clavesDisponibles = catalogoReal
        || [...catalogo, 'CHIPS_VER', 'CONFIGURACION_SEDES'];

    const query = async (sql, params = []) => {
        const normal = sql.replace(/\s+/g, ' ').trim();
        llamadas.push({ sql: normal, params });

        if (normal.startsWith('SELECT username, perfil_id, estado FROM fg_usuario')) {
            return actor
                ? { rowCount: 1, rows: [{ ...actor }] }
                : { rowCount: 0, rows: [] };
        }

        if (normal.startsWith('SELECT clave, activo FROM fg_permiso')) {
            const solicitadas = Array.isArray(params[0]) ? params[0] : [];
            return {
                rows: solicitadas
                    .filter((clave) => clavesDisponibles.includes(clave))
                    .map((clave) => ({ clave, activo: true }))
            };
        }

        if (normal.startsWith('SELECT permiso_clave FROM fg_perfil_permiso')
            && normal.includes('permiso_clave = ANY($2')) {
            const solicitadas = Array.isArray(params[1]) ? params[1] : [];
            return {
                rowCount: existentes.length,
                rows: existentes
                    .filter((clave) => solicitadas.includes(clave))
                    .map((clave) => ({ permiso_clave: clave }))
            };
        }

        if (normal.includes('SELECT pp.permiso_clave')
            && normal.includes('AND pp.permiso_clave = ANY')) {
            return {
                rowCount: actuales.length,
                rows: actuales.map((clave) => ({ permiso_clave: clave }))
            };
        }

        if (normal.includes('SELECT pp.permiso_clave')
            && normal.includes('WHERE pp.perfil_clave = $1')) {
            return {
                rowCount: permisosActor.length,
                rows: permisosActor.map((clave) => ({ permiso_clave: clave }))
            };
        }

        if (normal.startsWith('SELECT clave FROM fg_permiso')
            && normal.includes("modulo = 'MENU'")) {
            return { rows: catalogo.map((clave) => ({ clave })) };
        }

        if (normal.startsWith('SELECT clave FROM fg_permiso')
            && normal.includes('clave = ANY($1')) {
            const solicitadas = Array.isArray(params[0]) ? params[0] : [];
            return {
                rows: disponibles
                    .filter((clave) => solicitadas.includes(clave))
                    .map((clave) => ({ clave }))
            };
        }

        if (normal.startsWith('DELETE FROM fg_perfil_permiso')) {
            return { rowCount: params[1]?.length || 0, rows: [] };
        }

        if (normal.startsWith('INSERT INTO fg_perfil_permiso')) {
            return { rowCount: params[1]?.length || 0, rows: [] };
        }

        if (normal.startsWith('INSERT INTO fg_auditoria_config')) {
            return { rowCount: 1, rows: [] };
        }

        throw new Error(`Consulta no simulada: ${normal}`);
    };

    return {
        query,
        llamadas,
        escrituras: () => llamadas.filter(({ sql }) =>
            sql.startsWith('INSERT INTO fg_perfil_permiso')
            || sql.startsWith('DELETE FROM fg_perfil_permiso')),
        auditorias: () => llamadas.filter(({ sql }) =>
            sql.startsWith('INSERT INTO fg_auditoria_config'))
    };
};

const crearAuditoria = () => {
    const eventos = [];
    return {
        eventos,
        registrarEvento: async (evento) => { eventos.push(evento); }
    };
};

const capturarError = async (fn) => {
    try {
        await fn();
        return null;
    } catch (error) {
        return error;
    }
};

test('1. rechaza claves que no existen o no están activas e indica cuáles son', async () => {
    const executor = crearExecutor();
    const error = await capturarError(() => servicio.validarPermisosGestionables({
        executor,
        permisos: ['PERMISO_INVENTADO']
    }));

    assert.ok(error);
    assert.equal(error.code, 'PERMISOS_NO_DISPONIBLES');
    assert.equal(error.statusCode, 400);
    assert.deepEqual(error.detalles.claves, ['PERMISO_INVENTADO']);
});

test('1b. rechaza claves válidas que no administra el editor e indica cuáles son', async () => {
    const executor = crearExecutor();
    const error = await capturarError(() => servicio.validarPermisosGestionables({
        executor,
        permisos: ['CHIPS_VER']
    }));

    assert.ok(error);
    assert.equal(error.code, 'PERMISOS_NO_GESTIONABLES');
    assert.equal(error.statusCode, 400);
    assert.deepEqual(error.detalles.claves, ['CHIPS_VER']);
});

test('1c. tolera claves históricas ya asignadas, pero no las vuelve a escribir', async () => {
    const executor = crearExecutor({ existentes: ['CHIPS_VER'] });
    const validados = await servicio.validarPermisosGestionables({
        executor,
        perfilClave: 'SUPERVISOR',
        permisos: ['MENU_INICIO', 'CHIPS_VER']
    });

    assert.deepEqual(validados.permisos, ['MENU_INICIO', 'CHIPS_VER']);
    assert.deepEqual(validados.permisosGestionables, ['MENU_INICIO']);
});

test('2. un actor sin MENU_USUARIOS no puede conceder permisos sensibles', async () => {
    const executor = crearExecutor({ permisosActor: ['FAREGAS_SOLICITUD_VER'] });
    const auditoria = crearAuditoria();

    const error = await capturarError(() => servicio.aplicarPermisosSensibles({
        executor,
        perfilClave: 'SUPERVISOR',
        permisosSensibles: ['FAREGAS_SOLICITUD_APROBAR'],
        actor: { username: 'admin' },
        auditoriaService: auditoria
    }));

    assert.ok(error);
    assert.equal(error.code, 'PERFILES_NO_AUTORIZADO');
    assert.equal(error.statusCode, 403);
    assert.equal(executor.escrituras().length, 0);
    assert.equal(executor.auditorias().length, 0);
    assert.equal(auditoria.eventos.length, 1);
    assert.equal(auditoria.eventos[0].evento, 'PERMISOS_SENSIBLES_DENEGADO');
    assert.equal(auditoria.eventos[0].exitoso, false);
    assert.equal(auditoria.eventos[0].datos.perfil, 'SUPERVISOR');
    assert.deepEqual(auditoria.eventos[0].datos.otorgados, ['FAREGAS_SOLICITUD_APROBAR']);
});

test('3. un administrador de perfiles concede a SUPERVISOR y audita el otorgamiento', async () => {
    const executor = crearExecutor();
    const resultado = await servicio.aplicarPermisosSensibles({
        executor,
        perfilClave: 'SUPERVISOR',
        permisosSensibles: ['FAREGAS_SOLICITUD_APROBAR'],
        actor: { username: 'admin' },
        contexto: { ip_direccion: '127.0.0.1' }
    });

    assert.equal(resultado.sinCambios, false);
    assert.deepEqual(resultado.otorgados, ['FAREGAS_SOLICITUD_APROBAR']);
    assert.deepEqual(resultado.revocados, []);

    const insercion = executor.llamadas.find(({ sql }) =>
        sql.startsWith('INSERT INTO fg_perfil_permiso'));
    assert.deepEqual(insercion.params, ['SUPERVISOR', ['FAREGAS_SOLICITUD_APROBAR']]);

    const auditoria = executor.auditorias()[0];
    assert.ok(auditoria);
    assert.equal(auditoria.params[0], 'admin');
    assert.equal(auditoria.params[2], 'ACTUALIZAR_PERMISOS_SENSIBLES');
    assert.equal(auditoria.params[3], 'SUPERVISOR');
    assert.equal(auditoria.params[6], '127.0.0.1');
    const detalles = JSON.parse(auditoria.params[4]);
    assert.equal(detalles.perfil, 'SUPERVISOR');
    assert.deepEqual(detalles.otorgados, ['FAREGAS_SOLICITUD_APROBAR']);
    assert.deepEqual(detalles.revocados, []);
    assert.equal(detalles.resultado, 'EXITOSO');
});

test('4. un administrador de perfiles revoca de CAJERO y audita la revocación', async () => {
    const executor = crearExecutor({ actuales: ['FAREGAS_NOTA_CREDITO'] });
    const resultado = await servicio.aplicarPermisosSensibles({
        executor,
        perfilClave: 'CAJERO',
        permisosSensibles: [],
        actor: { username: 'admin' }
    });

    assert.deepEqual(resultado.otorgados, []);
    assert.deepEqual(resultado.revocados, ['FAREGAS_NOTA_CREDITO']);

    const borrado = executor.llamadas.find(({ sql }) =>
        sql.startsWith('DELETE FROM fg_perfil_permiso'));
    assert.deepEqual(borrado.params, ['CAJERO', ['FAREGAS_NOTA_CREDITO']]);

    const detalles = JSON.parse(executor.auditorias()[0].params[4]);
    assert.deepEqual(detalles.revocados, ['FAREGAS_NOTA_CREDITO']);
});

test('5. omitir permisosSensibles conserva lo existente sin exigir autorización', async () => {
    const executor = crearExecutor({
        actuales: ['FAREGAS_SOLICITUD_APROBAR'],
        permisosActor: []
    });

    const resultado = await servicio.aplicarPermisosSensibles({
        executor,
        perfilClave: 'SUPERVISOR',
        actor: { username: 'sin_permiso' }
    });

    assert.equal(resultado.sinCambios, true);
    assert.deepEqual(resultado.permisosSensibles, ['FAREGAS_SOLICITUD_APROBAR']);
    assert.equal(executor.escrituras().length, 0);
    assert.equal(executor.auditorias().length, 0);
    assert.equal(executor.llamadas.some(({ sql }) =>
        sql.startsWith('SELECT username, perfil_id, estado FROM fg_usuario')), false);
});

test('6. un perfil no SISTEMAS con MENU_USUARIOS efectivo puede administrar', async () => {
    const executor = crearExecutor({
        actor: { username: 'supervisor_admin', perfil_id: 'SUPERVISOR', estado: true }
    });

    const resultado = await servicio.aplicarPermisosSensibles({
        executor,
        perfilClave: 'CAJERO',
        permisosSensibles: ['FAREGAS_ANULAR_COMPROBANTE'],
        actor: { username: 'supervisor_admin' }
    });

    assert.deepEqual(resultado.otorgados, ['FAREGAS_ANULAR_COMPROBANTE']);
    assert.equal(executor.auditorias().length, 1);
});

test('7. la lista completa deriva los sensibles y no descarta ninguna clave', async () => {
    const executor = crearExecutor();
    const validados = await servicio.validarPermisosGestionables({
        executor,
        permisos: [
            'MENU_INICIO',
            'FAREGAS_SOLICITUD_APROBAR',
            'FAREGAS_NOTA_CREDITO',
            'FAREGAS_PERMISOS_SENSIBLES_ADMINISTRAR'
        ]
    });

    assert.deepEqual(validados.permisos, [
        'MENU_INICIO',
        'FAREGAS_SOLICITUD_APROBAR',
        'FAREGAS_NOTA_CREDITO'
    ]);
    assert.deepEqual(validados.permisosSensibles, [
        'FAREGAS_SOLICITUD_APROBAR',
        'FAREGAS_NOTA_CREDITO'
    ]);
});

test('7b. una lista con sólo la clave obsoleta no borra los permisos vigentes', async () => {
    const executor = crearExecutor();
    const validados = await servicio.validarPermisosGestionables({
        executor,
        permisos: ['FAREGAS_PERMISOS_SENSIBLES_ADMINISTRAR']
    });

    assert.equal(validados.permisos, undefined);
    assert.equal(validados.permisosSensibles, undefined);
    assert.equal(validados.permisosGestionables, undefined);
});

test('7c. si se envían ambas listas, la unión conserva todos los sensibles', async () => {
    const executor = crearExecutor();
    const validados = await servicio.validarPermisosGestionables({
        executor,
        permisos: ['MENU_INICIO', 'FAREGAS_SOLICITUD_APROBAR'],
        permisosSensibles: ['FAREGAS_NOTA_CREDITO']
    });

    assert.deepEqual(validados.permisos, ['MENU_INICIO', 'FAREGAS_SOLICITUD_APROBAR']);
    assert.deepEqual(validados.permisosSensibles, [
        'FAREGAS_NOTA_CREDITO',
        'FAREGAS_SOLICITUD_APROBAR'
    ]);
});

test('8. guardar el mismo conjunto no reescribe ni audita', async () => {
    const executor = crearExecutor({ actuales: ['FAREGAS_SOLICITUD_APROBAR'] });
    const resultado = await servicio.aplicarPermisosSensibles({
        executor,
        perfilClave: 'SUPERVISOR',
        permisosSensibles: ['FAREGAS_SOLICITUD_APROBAR'],
        actor: { username: 'admin' }
    });

    assert.equal(resultado.sinCambios, true);
    assert.equal(executor.escrituras().length, 0);
    assert.equal(executor.auditorias().length, 0);
});

test('9. la autorización de perfiles se calcula con permisos efectivos, no con el nombre del perfil', async () => {
    const conPermiso = crearExecutor({
        actor: { username: 'cajero_admin', perfil_id: 'CAJERO', estado: true }
    });
    const sinPermiso = crearExecutor({
        actor: { username: 'supervisor', perfil_id: 'SUPERVISOR', estado: true },
        permisosActor: []
    });

    const autorizado = await servicio.verificarAutorizacionPerfiles({
        executor: conPermiso,
        actor: { username: 'cajero_admin' }
    });
    assert.equal(autorizado.username, 'cajero_admin');

    const error = await capturarError(() => servicio.verificarAutorizacionPerfiles({
        executor: sinPermiso,
        actor: { username: 'supervisor' },
        auditoriaService: crearAuditoria()
    }));
    assert.ok(error);
    assert.equal(error.code, 'PERFILES_NO_AUTORIZADO');
    assert.equal(error.statusCode, 403);
});

const crearClientePerfil = ({
    actualesSensibles = [],
    permisosActor = [FAREGAS_PERMISO_ADMINISTRAR_PERFILES],
    actor = { username: 'editor', perfil_id: 'CAJERO', estado: true },
    catalogo = [
        'MENU_INICIO',
        'MENU_USUARIOS',
        'FAREGAS_SOLICITUD_CREAR',
        'FAREGAS_SOLICITUD_VER',
        ...PERMISOS_SENSIBLES
    ],
    catalogoReal = null,
    existentes = []
} = {}) => {
    const llamadas = [];
    const clavesDisponibles = catalogoReal
        || [...catalogo, 'CHIPS_VER', 'CONFIGURACION_SEDES'];
    const client = {
        query: async (sql, params = []) => {
            llamadas.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
            const normal = sql.replace(/\s+/g, ' ').trim();

            if (normal === 'BEGIN' || normal === 'COMMIT' || normal === 'ROLLBACK') {
                return { rowCount: 0, rows: [] };
            }
            if (normal.includes('FROM fg_perfil WHERE clave = $1 FOR UPDATE')) {
                return { rowCount: 1, rows: [{ bloqueado: 1 }] };
            }
            if (normal.startsWith('SELECT clave, activo FROM fg_permiso')) {
                const solicitadas = Array.isArray(params[0]) ? params[0] : [];
                return {
                    rowCount: solicitadas.length,
                    rows: solicitadas
                        .filter((clave) => clavesDisponibles.includes(clave))
                        .map((clave) => ({ clave, activo: true }))
                };
            }
            if (normal.startsWith('SELECT permiso_clave FROM fg_perfil_permiso')
                && normal.includes('permiso_clave = ANY($2')) {
                const solicitadas = Array.isArray(params[1]) ? params[1] : [];
                return {
                    rowCount: existentes.length,
                    rows: existentes
                        .filter((clave) => solicitadas.includes(clave))
                        .map((clave) => ({ permiso_clave: clave }))
                };
            }
            if (normal.startsWith('SELECT clave FROM fg_permiso')
                && normal.includes("modulo = 'MENU'")) {
                return {
                    rowCount: catalogo.length,
                    rows: catalogo.map((clave) => ({ clave }))
                };
            }
            if (normal.startsWith('SELECT clave FROM fg_permiso')
                && normal.includes('clave = ANY($1')) {
                const solicitadas = Array.isArray(params[0]) ? params[0] : [];
                return {
                    rowCount: solicitadas.length,
                    rows: solicitadas.map((clave) => ({ clave }))
                };
            }
            if (normal.includes('SELECT pp.permiso_clave')
                && normal.includes('AND pp.permiso_clave = ANY')) {
                return {
                    rowCount: actualesSensibles.length,
                    rows: actualesSensibles.map((clave) => ({ permiso_clave: clave }))
                };
            }
            if (normal.startsWith('SELECT username, perfil_id, estado FROM fg_usuario')) {
                return { rowCount: 1, rows: [{ ...actor }] };
            }
            if (normal.includes('SELECT pp.permiso_clave')
                && normal.includes('WHERE pp.perfil_clave = $1')) {
                return {
                    rowCount: permisosActor.length,
                    rows: permisosActor.map((clave) => ({ permiso_clave: clave }))
                };
            }
            return { rowCount: 1, rows: [] };
        },
        release: () => {}
    };
    return { client, llamadas };
};

test('10. editar sin enviar permisos conserva los sensibles persistidos', async () => {
    const db = require('../../../config/database');
    const originalConnect = db.connect;
    const { client, llamadas } = crearClientePerfil({
        actualesSensibles: ['FAREGAS_SOLICITUD_APROBAR']
    });
    db.connect = async () => client;

    try {
        await usuariosService.actualizarPerfil('SUPERVISOR', {
            nombre: 'Supervisor',
            visible: true,
            sedes: []
        }, { username: 'editor' });
    } finally {
        db.connect = originalConnect;
    }

    assert.equal(llamadas.some(({ sql }) =>
        sql.startsWith('DELETE FROM fg_perfil_permiso')), false);
    assert.equal(llamadas.some(({ sql }) =>
        sql.startsWith('INSERT INTO fg_perfil_permiso')), false);
    assert.ok(llamadas.some(({ sql }) => sql === 'COMMIT'));
    assert.equal(llamadas.some(({ sql }) => sql === 'ROLLBACK'), false);
});

test('11. actualizar con la lista completa persiste y revoca los sensibles desmarcados', async () => {
    const db = require('../../../config/database');
    const originalConnect = db.connect;
    const { client, llamadas } = crearClientePerfil({
        actualesSensibles: ['FAREGAS_NOTA_CREDITO']
    });
    db.connect = async () => client;

    try {
        await usuariosService.actualizarPerfil('CAJERO', {
            nombre: 'Cajero',
            visible: true,
            sedes: [],
            permisos: ['MENU_INICIO', 'FAREGAS_SOLICITUD_APROBAR']
        }, { username: 'editor' });
    } finally {
        db.connect = originalConnect;
    }

    const insercionSensible = llamadas.find(({ sql }) =>
        sql.startsWith('INSERT INTO fg_perfil_permiso') && sql.includes('unnest'));
    assert.ok(insercionSensible);
    assert.deepEqual(insercionSensible.params, ['CAJERO', ['FAREGAS_SOLICITUD_APROBAR']]);

    const borradoSensible = llamadas.find(({ sql }) =>
        sql.startsWith('DELETE FROM fg_perfil_permiso')
        && sql.includes('permiso_clave = ANY($2'));
    assert.ok(borradoSensible);
    assert.deepEqual(borradoSensible.params, ['CAJERO', ['FAREGAS_NOTA_CREDITO']]);
    assert.ok(llamadas.some(({ sql }) => sql === 'COMMIT'));
});

test('12. un actor sin MENU_USUARIOS no puede modificar su propio perfil para escalar', async () => {
    const db = require('../../../config/database');
    const auditoriaService = require('../services/faregas-auditoria.service');
    const originalConnect = db.connect;
    const originalRegistrarEvento = auditoriaService.registrarEvento;
    const eventos = [];
    const { client, llamadas } = crearClientePerfil({
        permisosActor: [],
        actor: { username: 'editor_sin_permiso', perfil_id: 'CAJERO', estado: true }
    });
    db.connect = async () => client;
    auditoriaService.registrarEvento = async (evento) => { eventos.push(evento); };

    try {
        const error = await capturarError(() => usuariosService.actualizarPerfil('CAJERO', {
            nombre: 'Cajero',
            visible: true,
            sedes: [],
            permisos: ['MENU_INICIO', 'MENU_USUARIOS', 'FAREGAS_SOLICITUD_APROBAR']
        }, { username: 'editor_sin_permiso' }));
        assert.ok(error);
        assert.equal(error.code, 'PERFILES_NO_AUTORIZADO');
        assert.equal(error.statusCode, 403);
    } finally {
        db.connect = originalConnect;
        auditoriaService.registrarEvento = originalRegistrarEvento;
    }

    assert.equal(llamadas.some(({ sql }) => sql === 'COMMIT'), false);
    assert.ok(llamadas.some(({ sql }) => sql === 'ROLLBACK'));
    assert.equal(llamadas.some(({ sql }) =>
        sql.startsWith('DELETE FROM fg_perfil_permiso')), false);
    assert.equal(llamadas.some(({ sql }) =>
        sql.startsWith('INSERT INTO fg_perfil_permiso')), false);
    assert.equal(eventos.length, 1);
    assert.equal(eventos[0].evento, 'PERMISOS_SENSIBLES_DENEGADO');
    assert.equal(eventos[0].datos.perfil, 'CAJERO');
});

test('13. crear un perfil con permisos sensibles los persiste y audita', async () => {
    const db = require('../../../config/database');
    const originalConnect = db.connect;
    const { client, llamadas } = crearClientePerfil();
    db.connect = async () => client;

    try {
        await usuariosService.crearPerfil({
            clave: 'SUPERVISOR',
            nombre: 'Supervisor',
            visible: true,
            sedes: [],
            permisos: ['MENU_INICIO', 'FAREGAS_SOLICITUD_APROBAR']
        }, { username: 'editor' });
    } finally {
        db.connect = originalConnect;
    }

    const insercionSensible = llamadas.find(({ sql }) =>
        sql.startsWith('INSERT INTO fg_perfil_permiso') && sql.includes('unnest'));
    assert.ok(insercionSensible);
    assert.deepEqual(insercionSensible.params, ['SUPERVISOR', ['FAREGAS_SOLICITUD_APROBAR']]);
    assert.ok(llamadas.some(({ sql }) => sql.startsWith('INSERT INTO fg_auditoria_config')));
    assert.ok(llamadas.some(({ sql }) => sql === 'COMMIT'));
});

test('13b. un payload completo con permisos históricos ya asignados no falla y los conserva', async () => {
    const db = require('../../../config/database');
    const originalConnect = db.connect;
    const { client, llamadas } = crearClientePerfil({
        existentes: ['CHIPS_VER', 'CONFIGURACION_SEDES']
    });
    db.connect = async () => client;

    try {
        await usuariosService.actualizarPerfil('SUPERVISOR', {
            nombre: 'Supervisor',
            visible: true,
            sedes: [],
            permisos: [
                'MENU_INICIO',
                'FAREGAS_SOLICITUD_APROBAR',
                'CHIPS_VER',
                'CONFIGURACION_SEDES'
            ]
        }, { username: 'editor' });
    } finally {
        db.connect = originalConnect;
    }

    const insercionesNoSensibles = llamadas.filter(({ sql }) =>
        sql.startsWith('INSERT INTO fg_perfil_permiso') && !sql.includes('unnest'));
    assert.deepEqual(
        insercionesNoSensibles.map(({ params }) => params[1]),
        ['MENU_INICIO']
    );
    assert.ok(llamadas.some(({ sql }) => sql === 'COMMIT'));
    assert.equal(llamadas.some(({ sql }) => sql === 'ROLLBACK'), false);
});

test('13c. rechaza un permiso válido fuera del catálogo si no estaba asignado', async () => {
    const db = require('../../../config/database');
    const originalConnect = db.connect;
    const { client, llamadas } = crearClientePerfil();
    db.connect = async () => client;

    let error;
    try {
        error = await capturarError(() => usuariosService.actualizarPerfil('SUPERVISOR', {
            nombre: 'Supervisor',
            visible: true,
            sedes: [],
            permisos: ['MENU_INICIO', 'CHIPS_VER']
        }, { username: 'editor' }));
    } finally {
        db.connect = originalConnect;
    }

    assert.ok(error);
    assert.equal(error.code, 'PERMISOS_NO_GESTIONABLES');
    assert.deepEqual(error.detalles.claves, ['CHIPS_VER']);
    assert.ok(llamadas.some(({ sql }) => sql === 'ROLLBACK'));
    assert.equal(llamadas.some(({ sql }) =>
        sql.startsWith('DELETE FROM fg_perfil_permiso')), false);
});

test('14. obtenerPerfiles devuelve lo persistido y oculta el permiso obsoleto', async () => {
    const db = require('../../../config/database');
    const originalQuery = db.query;
    db.query = async () => ({
        rowCount: 1,
        rows: [{
            clave: 'SUPERVISOR',
            nombre: 'Supervisor',
            visible: true,
            num_usuarios: 1,
            sedes: [],
            permisos: [
                'MENU_INICIO',
                'FAREGAS_SOLICITUD_APROBAR',
                'FAREGAS_PERMISOS_SENSIBLES_ADMINISTRAR'
            ]
        }]
    });

    try {
        const perfiles = await usuariosService.obtenerPerfiles();
        assert.deepEqual(perfiles[0].permisos, ['MENU_INICIO', 'FAREGAS_SOLICITUD_APROBAR']);
    } finally {
        db.query = originalQuery;
    }
});

test('15. la ruta usa MENU_USUARIOS y no exige una autorización sensible adicional', () => {
    const routes = fs.readFileSync(
        path.join(__dirname, '..', 'routes', 'faregas-usuarios.routes.js'),
        'utf8'
    );
    const constantes = fs.readFileSync(
        path.join(__dirname, '..', 'services', 'faregas-permisos-sensibles.constants.js'),
        'utf8'
    );

    assert.match(routes, /FAREGAS_PERMISO_ADMINISTRAR_PERFILES/);
    assert.match(routes, /permisos\.includes\(FAREGAS_PERMISO_ADMINISTRAR_PERFILES\)/);
    assert.doesNotMatch(routes, /FAREGAS_PERMISOS_SENSIBLES_ADMINISTRAR/);
    assert.equal(FAREGAS_PERMISO_ADMINISTRAR_PERFILES, 'MENU_USUARIOS');
    assert.doesNotMatch(constantes, /const\s+FAREGAS_PERMISOS_SENSIBLES_ADMINISTRAR/);
});

test('16. la migración anterior no existe y el esquema maestro no siembra el permiso obsoleto', () => {
    const migrationsRoot = path.join(__dirname, '..', 'database');
    const migracion = path.join(
        migrationsRoot,
        'migrations_history/20261027_faregas_permisos_sensibles_administrar.sql'
    );
    const maestro = fs.readFileSync(
        path.join(migrationsRoot, 'migrations/0001_faregas_schema.sql'),
        'utf8'
    );

    assert.equal(fs.existsSync(migracion), false);
    assert.doesNotMatch(maestro, /FAREGAS_PERMISOS_SENSIBLES_ADMINISTRAR/);
});
