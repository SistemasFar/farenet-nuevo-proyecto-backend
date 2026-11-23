
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { Pool } = require('pg');

const testUrl = process.env.FAREGAS_USUARIOS_PG_URL;
test('alta de usuarios y custodia con las claves foráneas de PostgreSQL', { skip: !testUrl }, async t => {
    const url = new URL(testUrl);
    assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname));
    assert.equal(url.pathname, '/faregas_usuarios_qa');
    assert.ok(url.port && !url.search && !url.hash);
    process.env.NODE_ENV = 'test';
    process.env.FAREGAS_CREDENTIAL_VAULT_KEY = randomBytes(32).toString('hex');
    const admin = new Pool({ connectionString: url.toString() });
    t.after(() => admin.end());
    const origen = await admin.query('SELECT current_database() AS nombre, inet_server_addr() AS servidor');
    assert.deepEqual(origen.rows[0], { nombre: 'faregas_usuarios_qa', servidor: '127.0.0.1' });
    const nombre = 'faregas_usuarios_qa_' + randomBytes(6).toString('hex');
    await admin.query('CREATE DATABASE ' + nombre);
    url.pathname = '/' + nombre;
    const pool = new Pool({ connectionString: url.toString() });
    t.after(() => pool.end());
    const modulo = require.resolve('../../../config/database');
    require.cache[modulo] = { exports: pool };

    const ddl = readFileSync(resolve(__dirname, '../database/faregas_consolidado.sql'), 'utf8');
    const tablas = ['fg_usuario', 'fg_usuario_perfil', 'fg_usuario_credencial', 'fg_credencial_custodia', 'fg_usuario_planta', 'fg_usuario_sesion', 'fg_ejecutivo'];
    const tabla = nombreTabla => {
        const definition = ddl.match(new RegExp('CREATE TABLE public\\.' + nombreTabla + ' \\([\\s\\S]*?\\r?\\n\\);'));
        assert.ok(definition, nombreTabla);
        return definition[0];
    };
    for (const nombreTabla of tablas) {
        await pool.query(tabla(nombreTabla));
        if (nombreTabla === 'fg_usuario') {
            await pool.query('ALTER TABLE fg_usuario ADD CONSTRAINT fg_usuario_pkey PRIMARY KEY (username)');
        }
    }
    await pool.query(
        'ALTER TABLE fg_usuario_perfil ADD PRIMARY KEY (usuario_username), ' +
        'ADD CONSTRAINT uq_fg_usuario_perfil_documento UNIQUE(tipo_documento_key, nro_documento), ' +
        'ADD CONSTRAINT fk_fg_usuario_perfil_usuario FOREIGN KEY (usuario_username) REFERENCES fg_usuario(username) ON UPDATE CASCADE ON DELETE CASCADE; ' +
        'CREATE TABLE fg_perfil(clave varchar PRIMARY KEY); ' +
        'ALTER TABLE fg_usuario ADD CONSTRAINT fk_fg_usuario_perfil FOREIGN KEY(perfil_id) REFERENCES fg_perfil(clave); ' +
        'CREATE TABLE fg_planta(key varchar PRIMARY KEY, nombre varchar, empresa_key varchar, activo boolean); ' +
        'CREATE TABLE fg_perfil_planta(perfil_clave varchar REFERENCES fg_perfil, planta_key varchar REFERENCES fg_planta, PRIMARY KEY (perfil_clave, planta_key)); ' +
        'ALTER TABLE fg_usuario_planta ADD PRIMARY KEY (usuario_username, plantas_key), ' +
        'ADD FOREIGN KEY (usuario_username) REFERENCES fg_usuario(username) ON UPDATE CASCADE, ' +
        'ADD FOREIGN KEY (plantas_key) REFERENCES fg_planta(key); ' +
        'CREATE TABLE fg_permiso(clave varchar PRIMARY KEY, activo boolean); ' +
        'CREATE TABLE fg_perfil_permiso(perfil_clave varchar, permiso_clave varchar); ' +
        'CREATE TABLE persona(nrodocumentoidentidad varchar PRIMARY KEY, nombrerazonsocial varchar); ' +
        "INSERT INTO fg_perfil VALUES ('OPERADOR'), ('CONTADOR'); " +
        "INSERT INTO fg_planta VALUES ('98','Sede QA','FAREGAS',true), ('99','Segunda sede QA','FAREGAS',true); " +
        "INSERT INTO fg_perfil_planta VALUES ('OPERADOR','98'), ('CONTADOR','99'); " +
        "INSERT INTO fg_permiso VALUES ('MENU_INICIO',true), ('MENU_FACTURACION',true); " +
        "INSERT INTO fg_perfil_permiso VALUES ('OPERADOR','MENU_INICIO'), ('CONTADOR','MENU_FACTURACION');"
    );

    const service = require('../services/faregas-usuarios.service');
    const auth = require('../services/faregas-auth.service');
    const custodia = require('../services/faregas-credencial-custodia.service');
    const password = 'ClaveSintetica#94';
    const usuario = (username, nroDocumento) => ({
        username, nroDocumento, tipoDocumentoKey: 'dni', password, confirmPassword: password,
        nombres: 'Persona', apellidos: 'Sintetica', direccion: 'Calle QA 123', email: 'qa@example.invalid',
        telefono: '900000001', paisKey: 'PE', departamentoKey: '15', provinciaKey: '1501',
        distritoKey: '150101', perfil_id: 'OPERADOR', estado: true, sedes: ['98']
    });
    await t.test('reproduce 23503 cuando la custodia usa otra capitalización en la misma transacción', async () => {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await client.query("INSERT INTO fg_usuario (username, user_type, contrasenha) VALUES ('NeNe', 'USER', 'hash-de-fixture')");
            await assert.rejects(client.query(
                "INSERT INTO fg_credencial_custodia (username,ciphertext,iv,tag,creado_por) VALUES ('nene','qa','qa','qa','qa')"
            ), { code: '23503', constraint: 'fk_fg_credencial_custodia_user' });
            await client.query('ROLLBACK');
        } finally {
            client.release();
        }
        const { rows } = await pool.query('SELECT count(*)::int AS total FROM fg_usuario');
        assert.equal(rows[0].total, 0);
    });

    await t.test('alta con mayúsculas conserva una sola identidad en usuario, perfil, sede y credenciales', async () => {
        await service.crearUsuario(usuario('NeNe', '10000001'), 'qa');
        const { rows } = await pool.query(
            'SELECT u.username, u.contrasenha, p.tipo_documento_key, s.plantas_key, ' +
            'm.username AS inventario, c.username AS custodia, c.ciphertext ' +
            'FROM fg_usuario u JOIN fg_usuario_perfil p ON p.usuario_username = u.username ' +
            'JOIN fg_usuario_planta s ON s.usuario_username = u.username ' +
            'JOIN fg_usuario_credencial m USING(username) JOIN fg_credencial_custodia c USING(username)'
        );
        assert.equal(rows.length, 1);
        assert.deepEqual([rows[0].username, rows[0].inventario, rows[0].custodia, rows[0].plantas_key], ['NeNe', 'NeNe', 'NeNe', '98']);
        assert.match(rows[0].contrasenha, /^\$2[aby]\$/);
        assert.notEqual(rows[0].ciphertext, password);
        assert.equal((await custodia.obtenerCredencialDescifrada(pool, 'NeNe')).password, password);
        assert.equal((await auth.validarFaregas('NeNe', password)).valido, true);
        assert.deepEqual(await auth.getPermisosPorPerfil('OPERADOR'), ['MENU_INICIO']);
        assert.ok((await service.obtenerUsuariosPaginado({ buscar: 'NeNe' })).items.some(item => item.username === 'NeNe'));
    });

    await t.test('edita documento, contacto, perfil y sede; cambia contraseña y restablece el acceso', async () => {
        const nuevo = 'OtraClaveSintetica#85';
        await service.actualizarUsuario('NeNe', {
            ...usuario('NeNe', '10000002'), nombres: 'Nombre Editado', telefono: '900000002',
            email: 'editado@example.invalid', perfil_id: 'CONTADOR', sedes: ['99'], password: '', confirmPassword: ''
        }, 'qa');
        const { rows } = await pool.query('SELECT nombres, nro_documento, telefono, email FROM fg_usuario_perfil WHERE usuario_username = $1', ['NeNe']);
        assert.deepEqual(rows[0], {nombres:'Nombre Editado', nro_documento:'10000002', telefono:'900000002', email:'editado@example.invalid'});
        assert.deepEqual((await auth.getPlantasPorUsuario('NeNe', 'CONTADOR')).map(x => x.key), ['99']);
        assert.deepEqual(await auth.getPermisosPorPerfil('CONTADOR'), ['MENU_FACTURACION']);
        await service.cambiarPassword('NeNe', nuevo, { opciones: { responsable: 'qa' } });
        assert.equal((await auth.validarFaregas('NeNe', password)).valido, false);
        assert.equal((await auth.validarFaregas('NeNe', nuevo)).valido, true);
        assert.equal((await custodia.obtenerCredencialDescifrada(pool, 'NeNe')).password, nuevo);
        await assert.rejects(service.crearUsuario(usuario('nene', '10000003'), 'qa'), { code: 'USUARIO_DUPLICADO_ACTIVO' });
        await assert.rejects(service.crearUsuario(usuario('otrapersona', '10000002'), 'qa'), { code: 'DOCUMENTO_DUPLICADO' });
        await service.desactivarUsuario('NeNe');
        assert.equal((await auth.validarFaregas('NeNe', nuevo)).valido, false);
        await assert.rejects(service.crearUsuario(usuario('nene', '10000003'), 'qa'), { code: 'USUARIO_DUPLICADO_INACTIVO' });
        await service.activarUsuario('NeNe');
        assert.equal((await auth.validarFaregas('NeNe', nuevo)).valido, true);
    });

    await t.test('dos altas concurrentes con distinta capitalización solo crean una cuenta', async () => {
        const ambos = await Promise.allSettled([
            service.crearUsuario(usuario('UniCoQA', '10000007'), 'qa'),
            service.crearUsuario(usuario('unicoqa', '10000008'), 'qa')
        ]);
        assert.equal(ambos.filter(resultado => resultado.status === 'fulfilled').length, 1);
        const rechazo = ambos.find(resultado => resultado.status === 'rejected');
        assert.equal(rechazo.reason.code, 'USUARIO_DUPLICADO_ACTIVO');
        const { rows } = await pool.query("SELECT count(*)::int AS total FROM fg_usuario WHERE LOWER(username) = 'unicoqa'");
        assert.equal(rows[0].total, 1);
    });

    await t.test('fallo real al guardar custodia revierte toda el alta y permite reintentar', async () => {
        await pool.query("ALTER TABLE fg_credencial_custodia ADD CONSTRAINT fallo_custodia_qa CHECK (username <> 'FallaQA')");
        const datos = usuario('FallaQA', '10000005');
        await assert.rejects(service.crearUsuario(datos, 'qa'), { code: '23514', constraint: 'fallo_custodia_qa' });
        const relaciones = [
            ['fg_usuario', 'username'], ['fg_usuario_perfil', 'usuario_username'],
            ['fg_usuario_planta', 'usuario_username'], ['fg_usuario_credencial', 'username'],
            ['fg_credencial_custodia', 'username']
        ];
        for (const [tabla, columna] of relaciones) {
            const { rowCount } = await pool.query('SELECT 1 FROM ' + tabla + ' WHERE ' + columna + '=$1', [datos.username]);
            assert.equal(rowCount, 0, tabla);
        }
        await pool.query('ALTER TABLE fg_credencial_custodia DROP CONSTRAINT fallo_custodia_qa');
        await service.crearUsuario(datos, 'qa');
        assert.equal((await auth.validarFaregas(datos.username, password)).valido, true);
    });
});
