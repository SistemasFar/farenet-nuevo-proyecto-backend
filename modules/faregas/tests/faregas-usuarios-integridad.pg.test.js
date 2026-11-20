// Integración real: sólo un servidor de pruebas independiente en 127.0.0.1:55439.
// Nunca carga .env ni usa la configuración de PostgreSQL compartido.
process.env.NODE_ENV = 'test';
const test = require('node:test');
const leerSeccionSql = require('./leer-seccion-sql');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const config = { host: '127.0.0.1', port: 55439, user: 'faregas_test', password: '', database: 'postgres' };

test('cuentas y perfiles: PostgreSQL aislado', { skip: process.env.FAREGAS_TEST_PG !== '1' }, async t => {
  const admin = new Pool(config);
  const nombre = 'codex_faregas_cuentas_' + Date.now();
  await admin.query(`CREATE DATABASE ${nombre}`);
  const db = new Pool({ ...config, database: nombre });
  const moduloDb = require.resolve('../../../config/database');
  require.cache[moduloDb] = { id: moduloDb, filename: moduloDb, loaded: true, exports: db };
  const service = require('../services/faregas-usuarios.service');
  const integridad = require('../services/faregas-cuentas-integridad.service');
  const actor = { username: 'admin' };
  const n = async tabla => Number((await db.query(`SELECT count(*) n FROM ${tabla}`)).rows[0].n);
  const codigo = code => e => { assert.equal(e.code, code); return true; };
  try {
    await db.query(`
      CREATE TABLE fg_perfil (clave varchar PRIMARY KEY, nombre varchar, visible boolean DEFAULT true);
      CREATE TABLE fg_permiso (clave varchar PRIMARY KEY, nombre varchar, modulo varchar, activo boolean DEFAULT true);
      CREATE TABLE fg_perfil_permiso (perfil_clave varchar REFERENCES fg_perfil, permiso_clave varchar REFERENCES fg_permiso, PRIMARY KEY(perfil_clave,permiso_clave));
      CREATE TABLE fg_planta (key varchar PRIMARY KEY);
      CREATE TABLE fg_perfil_planta (perfil_clave varchar REFERENCES fg_perfil, planta_key varchar REFERENCES fg_planta);
      CREATE TABLE persona (nrodocumentoidentidad varchar PRIMARY KEY,nombres varchar,apellidos varchar);
      CREATE TABLE fg_usuario (username varchar PRIMARY KEY, perfil_id varchar REFERENCES fg_perfil, estado boolean,
        user_type varchar,persona_nrodocumentoidentidad varchar REFERENCES persona);
      CREATE TABLE fg_usuario_perfil (usuario_username varchar PRIMARY KEY REFERENCES fg_usuario ON DELETE CASCADE,nombres varchar,apellidos varchar);
      CREATE TABLE fg_usuario_planta (usuario_username varchar REFERENCES fg_usuario,plantas_key varchar REFERENCES fg_planta);
      CREATE TABLE fg_usuario_sesion (id bigserial PRIMARY KEY,usuario_username varchar REFERENCES fg_usuario,isactive boolean,
        revoked_at_utc timestamp,logouttime_utc timestamp,refresh_token_hash text,session_jti uuid);
      CREATE TABLE fg_auditoria_config (id bigserial PRIMARY KEY,username varchar NOT NULL REFERENCES fg_usuario);
      CREATE TABLE fg_nueva_referencia (id bigserial PRIMARY KEY,responsable varchar REFERENCES fg_usuario ON DELETE CASCADE);
      CREATE TABLE fg_otra_dependencia_perfil (perfil varchar REFERENCES fg_perfil);
    `);
    const reset = async () => {
      for (const tabla of ['fg_otra_dependencia_perfil','fg_nueva_referencia','fg_auditoria_config','fg_usuario_sesion','fg_usuario_planta','fg_usuario_perfil','fg_usuario','fg_perfil_planta','fg_perfil_permiso','fg_planta','fg_permiso','fg_perfil','persona']) await db.query(`DELETE FROM ${tabla}`);
      await db.query(`INSERT INTO fg_perfil(clave,nombre) VALUES ('SISTEMAS','Sistemas'),('ADMIN_CUSTOM','Admin'),('SUPERVISOR','Supervisor'),('OPERADOR','Operador'),('VACIO','Vacío');
        INSERT INTO fg_permiso(clave,modulo) VALUES ('MENU_USUARIOS','MENU'),('VER','MENU');
        INSERT INTO fg_perfil_permiso VALUES ('SISTEMAS','MENU_USUARIOS'),('ADMIN_CUSTOM','MENU_USUARIOS'),('VACIO','VER');
        INSERT INTO fg_planta VALUES ('A'),('B');
        INSERT INTO fg_perfil_planta VALUES ('SUPERVISOR','A'),('OPERADOR','A'),('VACIO','B');
        INSERT INTO fg_usuario(username,perfil_id,estado) VALUES ('admin','SISTEMAS',true),('miguel','SUPERVISOR',true),('libre','OPERADOR',true);
        INSERT INTO fg_usuario_perfil VALUES ('miguel','MIGUEL','QUIJANO'),('libre','LIBRE','PRUEBA');
        INSERT INTO fg_usuario_planta VALUES ('miguel','A'),('libre','A');
        INSERT INTO fg_usuario_sesion(usuario_username,isactive,refresh_token_hash) VALUES ('miguel',true,'fixture'),('libre',true,'fixture');`);
    };
    await t.test('borra perfil vacío y sólo sus relaciones', async () => {
      await reset(); await service.eliminarPerfil('VACIO', {}, actor);
      assert.equal((await db.query("SELECT 1 FROM fg_perfil WHERE clave='VACIO'")).rowCount, 0);
      assert.equal(await n('fg_permiso'), 2); assert.equal(await n('fg_planta'), 2);
    });
    await t.test('requiere selección, muestra usuario y rechaza reemplazos inválidos', async () => {
      await reset();
      await assert.rejects(service.eliminarPerfil('SUPERVISOR', {}, actor), e => {
        assert.equal(e.code,'PERFIL_CON_USUARIOS'); assert.equal(e.usuarios[0].nombres,'MIGUEL'); return true;
      });
      for (const nuevoPerfilClave of ['SUPERVISOR','NO_EXISTE']) await assert.rejects(service.eliminarPerfil('SUPERVISOR',{nuevoPerfilClave},actor),codigo('PERFIL_REEMPLAZO_INVALIDO'));
      assert.equal((await db.query("SELECT perfil_id FROM fg_usuario WHERE username='miguel'")).rows[0].perfil_id,'SUPERVISOR');
    });
    await t.test('sedes incompatibles revierten sin quitar sedes ni cambiar permisos', async () => {
      await reset();
      await assert.rejects(service.eliminarPerfil('SUPERVISOR',{nuevoPerfilClave:'VACIO'},actor),codigo('PERFIL_SEDES_INCOMPATIBLES'));
      assert.equal(await n('fg_usuario_planta'),2); assert.equal(await n('fg_perfil'),5);
    });
    await t.test('reasigna y elimina atómicamente; revoca la sesión', async () => {
      await reset();
      const r=await service.eliminarPerfil('SUPERVISOR',{nuevoPerfilClave:'OPERADOR'},actor);
      assert.equal(r.nuevoPerfilClave,'OPERADOR'); assert.equal(r.usuariosReasignados,1);
      assert.equal((await db.query("SELECT perfil_id FROM fg_usuario WHERE username='miguel'")).rows[0].perfil_id,'OPERADOR');
      const sesion=(await db.query("SELECT * FROM fg_usuario_sesion WHERE usuario_username='miguel'")).rows[0];
      assert.equal(sesion.isactive,false); assert.equal(sesion.refresh_token_hash,null); assert.ok(sesion.revoked_at_utc);
      assert.equal(await n('fg_usuario_planta'),2);
    });
    await t.test('una FK de perfil adicional revierte la reasignación completa', async () => {
      await reset(); await db.query("INSERT INTO fg_otra_dependencia_perfil VALUES ('SUPERVISOR')");
      await assert.rejects(service.eliminarPerfil('SUPERVISOR',{nuevoPerfilClave:'OPERADOR'},actor),codigo('PERFIL_CON_DEPENDENCIAS'));
      assert.equal((await db.query("SELECT perfil_id FROM fg_usuario WHERE username='miguel'")).rows[0].perfil_id,'SUPERVISOR');
      assert.equal((await db.query("SELECT isactive FROM fg_usuario_sesion WHERE usuario_username='miguel'")).rows[0].isactive,true);
    });
    await t.test('elimina usuario libre con plantas_key, perfil personal y sesiones', async () => {
      await reset(); await service.eliminarUsuario('libre',actor);
      assert.equal((await db.query("SELECT 1 FROM fg_usuario WHERE username='libre'")).rowCount,0);
      assert.equal((await db.query("SELECT 1 FROM fg_usuario_sesion WHERE usuario_username='libre'")).rowCount,0);
      assert.equal(await n('fg_usuario_planta'),1);
    });
    await t.test('auditoría bloquea eliminación; sólo desactiva con acción explícita', async () => {
      await reset(); await db.query("INSERT INTO fg_auditoria_config(username) VALUES ('libre')");
      await assert.rejects(service.eliminarUsuario('libre',actor),codigo('USUARIO_CON_HISTORIAL'));
      assert.equal((await db.query("SELECT estado FROM fg_usuario WHERE username='libre'")).rows[0].estado,true);
      await service.desactivarUsuario('libre',actor);
      assert.equal(await n('fg_auditoria_config'),1); assert.equal(await n('fg_usuario_planta'),2);
      assert.equal((await db.query("SELECT isactive FROM fg_usuario_sesion WHERE usuario_username='libre'")).rows[0].isactive,false);
    });
    await t.test('detecta FK nuevas aunque tengan ON DELETE CASCADE y preserva historial', async () => {
      await reset(); await db.query("INSERT INTO fg_nueva_referencia(responsable) VALUES ('libre')");
      await assert.rejects(service.eliminarUsuario('libre',actor),codigo('USUARIO_CON_HISTORIAL'));
      assert.equal(await n('fg_nueva_referencia'),1);
    });
    await t.test('savepoint recupera 23503 tardío y restaura sesiones y sedes', async () => {
      await reset();
      await db.query(`CREATE FUNCTION impedir_baja() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'FK tardía' USING ERRCODE='23503'; END $$;
        CREATE TRIGGER impedir_baja BEFORE DELETE ON fg_usuario FOR EACH ROW EXECUTE PROCEDURE impedir_baja();`);
      await assert.rejects(service.eliminarUsuario('libre',actor),codigo('USUARIO_CON_HISTORIAL'));
      assert.equal(await n('fg_usuario_sesion'),2); assert.equal(await n('fg_usuario_planta'),2); assert.equal(await n('fg_usuario_perfil'),2);
      await db.query('DROP TRIGGER impedir_baja ON fg_usuario; DROP FUNCTION impedir_baja()');
    });
    await t.test('protege autoeliminación y autodesactivación desde servicio', async () => {
      await reset();
      for (const accion of [service.eliminarUsuario,service.desactivarUsuario]) await assert.rejects(accion('admin',actor),codigo('AUTO_ELIMINACION_PROHIBIDA'));
    });
    await t.test('protege último administrador efectivo aunque su perfil tenga otro nombre', async () => {
      await reset(); await db.query("UPDATE fg_usuario SET perfil_id='ADMIN_CUSTOM' WHERE username='admin'");
      await assert.rejects(service.desactivarUsuario('admin',{username:'otro'}),codigo('ULTIMO_ADMIN'));
      await assert.rejects(service.eliminarUsuario('admin',{username:'otro'}),codigo('ULTIMO_ADMIN'));
      await assert.rejects(service.eliminarPerfil('ADMIN_CUSTOM',{nuevoPerfilClave:'OPERADOR'},actor),codigo('ULTIMO_ADMIN_PERFIL'));
    });
    await t.test('dos bajas concurrentes no retiran ambos administradores', async () => {
      await reset(); await db.query("INSERT INTO fg_usuario(username,perfil_id,estado) VALUES ('admin2','ADMIN_CUSTOM',true)");
      const r=await Promise.allSettled([service.eliminarUsuario('admin',{username:'externo'}),service.eliminarUsuario('admin2',{username:'externo'})]);
      assert.equal(r.filter(x=>x.status==='fulfilled').length,1);
      assert.equal(r.find(x=>x.status==='rejected').reason.code,'ULTIMO_ADMIN');
    });
    await t.test('validación de transición protege PUT estado/rol', async () => {
      await reset(); const c=await db.connect();
      try {
        await c.query('BEGIN'); await integridad.bloquearCuentas(c);
        const u=(await c.query("SELECT * FROM fg_usuario WHERE username='admin'")).rows[0];
        await assert.rejects(integridad.protegerCuenta(c,u,actor,{estado:false,perfil:'SISTEMAS'}),codigo('AUTO_ELIMINACION_PROHIBIDA'));
        await assert.rejects(integridad.protegerCuenta(c,u,actor,{estado:true,perfil:'OPERADOR'}),codigo('ULTIMO_ADMIN'));
      } finally { await c.query('ROLLBACK');c.release(); }
    });
    await t.test('editar permisos no puede retirar la última administración', async () => {
      await reset();
      await assert.rejects(service.actualizarPerfil('SISTEMAS', { nombre: 'Sistemas', visible: true, sedes: [], permisos: [] }, actor), codigo('ULTIMO_ADMIN'));
      assert.equal(await integridad.esAdministrador(db, 'SISTEMAS'), true);
    });
    await t.test('middleware rechaza una sesión físicamente ausente', async () => {
      await reset();
      process.env.JWT_SECRET_FAREGAS = 'secreto_solo_fixture_aislado';
      const jwt = require('jsonwebtoken');
      const { authFaregasMiddleware } = require('../middlewares/faregas-auth.middleware');
      const token = jwt.sign({ username: 'libre', faregas_flow: 'authenticated', session_jti: '12345678-1234-1234-1234-123456789abc' }, process.env.JWT_SECRET_FAREGAS);
      let status; let next = false;
      const res = { status(code) { status = code; return this; }, json() { return this; } };
      await authFaregasMiddleware({ headers: { authorization: `Bearer ${token}` } }, res, () => { next = true; });
      assert.equal(status,401); assert.equal(next,false);
    });
    await t.test('migración 005: cascadas y retiro de FK de auditoría, sin borrar snapshots', async () => {
      await reset(); await db.query("INSERT INTO fg_auditoria_config(username) VALUES ('libre')");
      const migracion=leerSeccionSql('005');
      await db.query(migracion); await db.query(migracion);
      const referencias=(await db.query("SELECT count(*)::int n FROM pg_constraint WHERE contype='f' AND conrelid='fg_auditoria_config'::regclass")).rows[0].n;
      assert.equal(referencias,0);assert.equal(await n('fg_auditoria_config'),1);
      // La aplicación sigue preservando el historial incluso si alguien aplica 005.
      await assert.rejects(service.eliminarUsuario('libre',actor),codigo('USUARIO_CON_HISTORIAL'));
    });
    await t.test('respaldo real restaurado y simulación conservadora sin cambios', async () => {
      const out=path.resolve(__dirname,'../../../../output/usuarios-perfiles-faregas');
      const snapshot=JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(out,'respaldo-auditoria.json.gz'))));
      await db.query('CREATE SCHEMA copia_auditoria');
      const resultados=[];
      for (const [tabla,rows] of Object.entries(snapshot.tablas)) {
        // Copia aislada en JSONB: conserva todos los campos y evita dependencias
        // sobre maestros compartidos. No reemplaza las pruebas de FK anteriores.
        await db.query(`CREATE TABLE copia_auditoria.${tabla} (id bigint PRIMARY KEY, datos jsonb NOT NULL)`);
        for (const row of rows) await db.query(`INSERT INTO copia_auditoria.${tabla} VALUES ($1,$2::jsonb)`,[row.id,JSON.stringify(row)]);
        const antes=Number((await db.query(`SELECT count(*) n FROM copia_auditoria.${tabla}`)).rows[0].n);
        const ids=tabla==='fg_usuario_sesion' ? snapshot.candidatosSesiones : [];
        await db.query('BEGIN');
        const borradas=await db.query(`DELETE FROM copia_auditoria.${tabla} WHERE id=ANY($1::bigint[])`,[ids]);
        const despues=Number((await db.query(`SELECT count(*) n FROM copia_auditoria.${tabla}`)).rows[0].n);
        await db.query('ROLLBACK');
        assert.equal(antes,rows.length);assert.equal(despues,antes-ids.length);
        resultados.push({tabla,antes,eliminadasSimulacion:borradas.rowCount,despues,rollback:true});
      }
      fs.writeFileSync(path.join(out,'simulacion-aislada.json'),JSON.stringify({postgresAislado:true,resultados},null,2));
    });
  } finally {
    await db.end();
    await admin.query(`DROP DATABASE ${nombre}`);
    await admin.end();
  }
});
