const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const db = require('../../../config/database');
const bcrypt = require('bcryptjs');
const service = require('../services/faregas-usuarios.service');
const authService = require('../services/faregas-auth.service');
const permisosSensiblesService = require('../services/faregas-permisos-sensibles.service');

const persona = {
    nrodocumentoidentidad: '74045612',
    tipodocumentoidentidad_key: 'DNI',
    nombres: 'Grace',
    apellidos: 'Ibarra',
    nombrerazonsocial: null,
    pais_key: 'PE',
    departamento_key: '15',
    provincia_key: '1501',
    distrito_key: '150101',
    direccion: 'AVENIDA DEMO 123',
    email: 'grace@example.test',
    telefono: '987654321',
    persona_contacto: null
};

const datosUsuario = (overrides = {}) => ({
    username: 'faregas.demo',
    password: 'Temporal123',
    confirmPassword: 'Temporal123',
    perfil_id: null,
    estado: true,
    user_type: 'USER',
    tipoDocumentoKey: 'DNI',
    nroDocumento: '74045612',
    nombres: 'Grace',
    apellidos: 'Ibarra',
    nombreRazonSocial: '',
    paisKey: 'PE',
    departamentoKey: '15',
    provinciaKey: '1501',
    distritoKey: '150101',
    direccion: 'AVENIDA DEMO 123',
    email: 'grace@example.test',
    telefono: '987654321',
    personaContacto: '',
    sedes: [],
    ...overrides
});

const conClienteFalso = async (responder, ejecutar) => {
    const connectOriginal = db.connect;
    const consultas = [];
    db.connect = async () => ({
        query: async (sql, params) => {
            const normalizado = sql.replace(/\s+/g, ' ').trim();
            consultas.push({ sql: normalizado, params });
            return responder(normalizado, params) || { rows: [], rowCount: 1 };
        },
        release: () => {}
    });
    try {
        await ejecutar(consultas);
    } finally {
        db.connect = connectOriginal;
    }
};

const assertSinEscriturasHeredadas = (consultas) => {
    for (const { sql } of consultas) {
        assert.doesNotMatch(sql, /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE)\s+(?:public\.)?(?:persona|usuario|vehiculo|tarjetapropiedad|cuentacorriente)\b/i);
    }
};

test('crearUsuario independiente escribe fg_usuario y fg_usuario_perfil sin consultar persona', async () => {
    await conClienteFalso((sql) => {
        if (/to_regclass\('public\.fg_usuario_perfil'\)/i.test(sql)) return { rows: [{ disponible: true }], rowCount: 1 };
        return null;
    }, async (consultas) => {
        await service.crearUsuario(datosUsuario(), 'admin');
        assert.ok(!consultas.some(({ sql }) => /\bFROM persona\b/i.test(sql)));
        assert.ok(consultas.some(({ sql }) => /^INSERT INTO fg_usuario\b/i.test(sql)));
        const perfil = consultas.find(({ sql }) => /^INSERT INTO public\.fg_usuario_perfil\b/i.test(sql));
        assert.ok(perfil);
        assert.match(consultas.find(({ sql }) => /^INSERT INTO fg_usuario\b/i.test(sql)).sql, /NULL\)/);
        assertSinEscriturasHeredadas(consultas);
    });
});

test('crearUsuario falla sin escribir hasta que exista la migración de perfil propio', async () => {
    await conClienteFalso((sql) => {
        if (/to_regclass\('public\.fg_usuario_perfil'\)/i.test(sql)) return { rows: [{ disponible: false }], rowCount: 1 };
        return null;
    }, async (consultas) => {
        await assert.rejects(
            service.crearUsuario(datosUsuario(), 'admin'),
            (error) => error.code === 'MIGRACION_PERFIL_FAREGAS_PENDIENTE'
        );
        assert.ok(!consultas.some(({ sql }) => /\bINSERT\s+INTO\s+fg_usuario\b/i.test(sql)));
        assert.ok(!consultas.some(({ sql }) => /\bFROM persona\b/i.test(sql)));
        assertSinEscriturasHeredadas(consultas);
    });
});

test('actualizarUsuario guarda cambios personales solo en fg_usuario_perfil', async () => {
    await conClienteFalso((sql) => {
        if (/to_regclass\('public\.fg_usuario_perfil'\)/i.test(sql)) return { rows: [{ disponible: true }], rowCount: 1 };
        return null;
    }, async (consultas) => {
        await service.actualizarUsuario('faregas.demo', datosUsuario({
            password: '',
            confirmPassword: '',
            nombres: 'Gracia',
            apellidos: 'Ibarra Prueba',
            direccion: 'AVENIDA PROPIA 456',
            email: 'nuevo@example.test',
            telefono: '900111222',
            estado: false,
            sedes: ['98']
        }), 'admin');
        assert.ok(consultas.some(({ sql, params }) => /^UPDATE fg_usuario\b/i.test(sql) && params.includes(false)));
        const perfil = consultas.find(({ sql }) => /^INSERT INTO public\.fg_usuario_perfil\b/i.test(sql));
        assert.ok(perfil);
        assert.ok(['Gracia', 'Ibarra Prueba', 'AVENIDA PROPIA 456', 'nuevo@example.test', '900111222']
            .every((valor) => perfil.params.includes(valor)));
        assert.ok(consultas.some(({ sql }) => /^DELETE FROM fg_usuario_planta\b/i.test(sql)));
        assert.ok(consultas.some(({ sql, params }) => /^INSERT INTO fg_usuario_planta\b/i.test(sql) && params.includes('98')));
        assert.ok(!consultas.some(({ sql }) => /\bFROM persona\b/i.test(sql)));
        assertSinEscriturasHeredadas(consultas);
    });
});

test('actualizarPerfil asigna permisos y sedes únicamente en tablas fg_*', async () => {
    const verificarOriginal = permisosSensiblesService.verificarAutorizacionPerfiles;
    const validarOriginal = permisosSensiblesService.validarPermisosGestionables;
    const aplicarOriginal = permisosSensiblesService.aplicarPermisosSensibles;
    permisosSensiblesService.verificarAutorizacionPerfiles = async () => ({ username: 'admin' });
    permisosSensiblesService.validarPermisosGestionables = async () => ({
        permisosGestionables: ['MENU_USUARIOS'],
        permisosSensibles: []
    });
    permisosSensiblesService.aplicarPermisosSensibles = async () => {};

    try {
        await conClienteFalso((sql) => {
            if (/^SELECT 1 FROM fg_perfil\b/i.test(sql)) return { rows: [{ '?column?': 1 }], rowCount: 1 };
            return null;
        }, async (consultas) => {
            await service.actualizarPerfil('OPERADOR', {
                nombre: 'Operador',
                visible: true,
                sedes: ['98'],
                permisos: ['MENU_USUARIOS'],
                permisosSensibles: []
            }, { username: 'admin' }, {});

            assert.ok(consultas.some(({ sql }) => /^UPDATE fg_perfil\b/i.test(sql)));
            assert.ok(consultas.some(({ sql }) => /^DELETE FROM fg_perfil_planta\b/i.test(sql)));
            assert.ok(consultas.some(({ sql, params }) => /^INSERT INTO fg_perfil_planta\b/i.test(sql) && params.includes('98')));
            assert.ok(consultas.some(({ sql }) => /^DELETE FROM fg_perfil_permiso\b/i.test(sql)));
            assert.ok(consultas.some(({ sql, params }) => /^INSERT INTO fg_perfil_permiso\b/i.test(sql) && params.includes('MENU_USUARIOS')));
            assertSinEscriturasHeredadas(consultas);
        });
    } finally {
        permisosSensiblesService.verificarAutorizacionPerfiles = verificarOriginal;
        permisosSensiblesService.validarPermisosGestionables = validarOriginal;
        permisosSensiblesService.aplicarPermisosSensibles = aplicarOriginal;
    }
});

test('sin migración, la edición de atributos FAREGAS sigue si el perfil legacy no cambia', async () => {
    await conClienteFalso((sql) => {
        if (/to_regclass\('public\.fg_usuario_perfil'\)/i.test(sql)) return { rows: [{ disponible: false }], rowCount: 1 };
        if (/^SELECT .* FROM persona\b/i.test(sql)) return { rows: [persona], rowCount: 1 };
        return null;
    }, async (consultas) => {
        await service.actualizarUsuario('faregas.demo', datosUsuario({ estado: false, password: '', confirmPassword: '' }), 'admin');
        assert.ok(consultas.some(({ sql, params }) => /^UPDATE fg_usuario\b/i.test(sql) && params.includes(false)));
        assert.ok(consultas.some(({ sql }) => /^DELETE FROM fg_usuario_planta\b/i.test(sql)));
        assertSinEscriturasHeredadas(consultas);
    });
});

test('sin migración, editar el perfil personal se rechaza sin alterar persona', async () => {
    await conClienteFalso((sql) => {
        if (/to_regclass\('public\.fg_usuario_perfil'\)/i.test(sql)) return { rows: [{ disponible: false }], rowCount: 1 };
        if (/^SELECT .* FROM persona\b/i.test(sql)) return { rows: [persona], rowCount: 1 };
        return null;
    }, async (consultas) => {
        await assert.rejects(
            service.actualizarUsuario('faregas.demo', datosUsuario({ password: '', confirmPassword: '', direccion: 'CAMBIO PENDIENTE 123' }), 'admin'),
            (error) => error.code === 'PERFIL_PERSONA_FARENET_SOLO_LECTURA'
        );
        assert.ok(!consultas.some(({ sql }) => /^UPDATE fg_usuario\b/i.test(sql)));
        assertSinEscriturasHeredadas(consultas);
    });
});

test('autenticación FAREGAS valida el hash en fg_usuario', async () => {
    const queryOriginal = db.query;
    const consultas = [];
    db.query = async (sql) => {
        consultas.push(sql.replace(/\s+/g, ' ').trim());
        return {
            rows: [{
                username: 'faregas.demo',
                contrasenha: bcrypt.hashSync('Temporal123', 4),
                perfil_id: null,
                estado: true,
                user_type: 'USER'
            }]
        };
    };
    try {
        const resultado = await authService.validarFaregas('faregas.demo', 'Temporal123');
        assert.equal(resultado.valido, true);
        assert.match(consultas[0], /FROM fg_usuario\b/i);
        assert.doesNotMatch(consultas[0], /FROM usuario\b/i);
    } finally {
        db.query = queryOriginal;
    }
});

test('cambiarPassword actualiza exclusivamente fg_usuario', async () => {
    await conClienteFalso(() => ({ rows: [], rowCount: 1 }), async (consultas) => {
        await service.cambiarPassword('faregas.demo', 'NuevaTemporal123');
        assert.equal(consultas.filter(({ sql }) => /^UPDATE /i.test(sql)).length, 1);
        assert.ok(consultas.some(({ sql }) => /^UPDATE fg_usuario\b/i.test(sql)));
        assertSinEscriturasHeredadas(consultas);
    });
});

test('la migración consolidada verifica la cuenta sin escribir en cuentacorriente', () => {
    const migration = fs.readFileSync(path.join(__dirname, '../database/faregas_instalacion_completa.sql'), 'utf8');
    assert.match(migration, /DO \$faregas_cuenta_preflight\$/);
    assert.doesNotMatch(migration, /\bINSERT\s+INTO\s+public\.cuentacorriente\b/i);
    assert.doesNotMatch(migration, /\bUPDATE\s+public\.cuentacorriente\b/i);
});

test('el esquema maestro integra el perfil independiente sin FK hacia persona', () => {
    const schema = fs.readFileSync(path.join(__dirname, '../database/faregas_instalacion_completa.sql'), 'utf8');
    assert.match(schema, /CREATE TABLE public\.fg_usuario_perfil\s*\(/i);
    assert.match(schema, /ADD CONSTRAINT fg_usuario_perfil_pkey PRIMARY KEY \(usuario_username\)/i);
    assert.match(schema, /ADD CONSTRAINT uq_fg_usuario_perfil_documento UNIQUE \(tipo_documento_key, nro_documento\)/i);
    assert.match(
        schema,
        /ADD CONSTRAINT fk_fg_usuario_perfil_usuario FOREIGN KEY \(usuario_username\) REFERENCES public\.fg_usuario\(username\)/i
    );
    const definicionPerfil = schema.match(/CREATE TABLE public\.fg_usuario_perfil\s*\([\s\S]*?\n\);/i)?.[0] || '';
    assert.doesNotMatch(definicionPerfil, /REFERENCES public\.persona/i);
});

test('la migración incremental es aditiva, sin backfill y tolera inventario ausente', () => {
    const migration = fs.readFileSync(
        path.join(__dirname, '../database/archive/updates_existing/20261106_faregas_usuario_perfil.sql'),
        'utf8'
    );
    assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.fg_usuario_perfil/i);
    assert.match(migration, /tabla_movimiento oid := to_regclass\('public\.fg_inventario_cantidad_movimiento'\)/i);
    assert.match(migration, /IF tabla_movimiento IS NULL THEN\s+RETURN;/i);
    assert.match(migration, /FOREIGN KEY \(usuario\)\s+REFERENCES public\.fg_usuario \(username\)/i);
    assert.doesNotMatch(migration, /\bINSERT\s+INTO\s+(?:public\.)?(?:persona|usuario)\b/i);
    assert.doesNotMatch(migration, /\bUPDATE\s+(?:public\.)?(?:persona|usuario)\b/i);
    assert.doesNotMatch(migration, /\bDELETE\s+FROM\s+(?:public\.)?(?:persona|usuario)\b/i);
});

test('la plantilla de roles bloquea escritura runtime sobre tablas heredadas', () => {
    const roles = fs.readFileSync(
        path.join(__dirname, '../database/faregas_roles_postgresql.template.sql'),
        'utf8'
    );
    assert.match(roles, /DO \$faregas_runtime_sin_escritura_legacy\$/);
    assert.match(roles, /table_name NOT LIKE 'fg\\_%'/);
    assert.match(roles, /has_table_privilege\('faregas_runtime',[\s\S]*?'INSERT'\)/);
    assert.match(roles, /RAISE EXCEPTION[\s\S]*faregas_runtime conserva permisos de escritura/i);
    assert.doesNotMatch(
        roles,
        /GRANT\s+(?:INSERT|UPDATE|DELETE|TRUNCATE)[\s\S]*?ON TABLE\s+public\.(?!fg_)/i
    );
});

test('servicios y scripts FAREGAS no contienen DML/DDL sobre tablas heredadas revisadas', () => {
    const raizFaregas = path.join(__dirname, '..');
    const carpetas = [
        path.join(raizFaregas, 'services'),
        path.join(raizFaregas, 'integrations'),
        path.join(raizFaregas, 'database')
    ];
    const listarArchivos = (carpeta) => fs.readdirSync(carpeta, { withFileTypes: true })
        .flatMap((entrada) => {
            const archivo = path.join(carpeta, entrada.name);
            if (entrada.isDirectory()) return listarArchivos(archivo);
            return /\.(?:js|sql)$/i.test(entrada.name) ? [archivo] : [];
        });
    const archivos = carpetas.flatMap(listarArchivos);
    const escrituraHeredada = /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE\s+(?:TABLE\s+)?|ALTER\s+TABLE|CREATE\s+(?:UNIQUE\s+)?INDEX|CREATE\s+TRIGGER|DROP\s+(?:INDEX|TRIGGER))\s+(?:ONLY\s+)?(?:public\.)?(?:persona|usuario|vehiculo|tarjetapropiedad|categoria|vehiculoclase|marca|modelo|combustible|color|carroceria|moneda|formapago|cuentacorriente|entidadfinanciera|tarjeta|tipocontado|seriedocumentobase|tipodocumentoidentidad|pais|departamento|provincia|distrito)\b/i;
    const hallazgos = archivos.flatMap((archivo) => {
        const contenido = fs.readFileSync(archivo, 'utf8');
        return escrituraHeredada.test(contenido) ? [path.relative(raizFaregas, archivo)] : [];
    });
    assert.deepEqual(hallazgos, []);

    const cliente = fs.readFileSync(path.join(raizFaregas, 'services/faregas-clientes.service.js'), 'utf8');
    const vehiculos = fs.readFileSync(path.join(raizFaregas, 'services/faregas-vehiculos.service.js'), 'utf8');
    const certificados = fs.readFileSync(path.join(raizFaregas, 'services/faregas-certificados.service.js'), 'utf8');
    const adapter = fs.readFileSync(path.join(raizFaregas, 'integrations/farenet-read.adapter.js'), 'utf8');
    assert.match(cliente, /INSERT INTO fg_cliente/i);
    assert.match(vehiculos, /INSERT INTO fg_vehiculo/i);
    assert.match(certificados, /INSERT INTO fg_certificado_vehiculo/i);
    assert.match(adapter, /FROM persona/i);
    assert.match(adapter, /FROM vehiculo/i);
    assert.match(adapter, /FROM tarjetapropiedad/i);
    assert.doesNotMatch(adapter, /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\b/i);
});
