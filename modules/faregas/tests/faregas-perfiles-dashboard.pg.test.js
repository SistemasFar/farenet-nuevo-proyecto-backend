process.env.NODE_ENV='test';
const test=require('node:test'),assert=require('node:assert/strict'),{Pool}=require('pg');
test('crear/editar perfiles y retirar Preparación en PostgreSQL local aislado',{skip:process.env.FAREGAS_TEST_PG!=='1'},async()=>{
 const config={host:'127.0.0.1',port:55439,user:'faregas_test',password:'',database:'postgres'};
 const admin=new Pool(config),nombre='codex_perfiles_'+Date.now();await admin.query(`CREATE DATABASE ${nombre}`);const db=new Pool({...config,database:nombre});
 const id=require.resolve('../../../config/database');require.cache[id]={id,filename:id,loaded:true,exports:db};
 const auditId=require.resolve('../services/faregas-auditoria.service');require.cache[auditId]={id:auditId,filename:auditId,loaded:true,exports:{registrarEvento:async()=>{}}};
 const service=require('../services/faregas-usuarios.service');
 const vigentes=['MENU_FACTURACION','MENU_FACTURACION_SERIES','MENU_FACTURACION_COMPROBANTES','MENU_FACTURACION_CLIENTES'];
 try{await db.query(`
 CREATE TABLE fg_perfil(clave varchar PRIMARY KEY,nombre varchar,visible boolean);
 CREATE TABLE fg_permiso(clave varchar PRIMARY KEY,nombre varchar,modulo varchar,activo boolean DEFAULT TRUE);
 CREATE TABLE fg_perfil_permiso(perfil_clave varchar REFERENCES fg_perfil,permiso_clave varchar REFERENCES fg_permiso,PRIMARY KEY(perfil_clave,permiso_clave));
 CREATE TABLE fg_planta(key varchar PRIMARY KEY);
 CREATE TABLE fg_perfil_planta(perfil_clave varchar REFERENCES fg_perfil,planta_key varchar REFERENCES fg_planta);
 CREATE TABLE fg_usuario(username varchar PRIMARY KEY,perfil_id varchar REFERENCES fg_perfil,estado boolean);
 CREATE TABLE fg_usuario_planta(usuario_username varchar REFERENCES fg_usuario,plantas_key varchar REFERENCES fg_planta);
 CREATE TABLE fg_auditoria_config(username varchar,entidad varchar,accion varchar,identificador varchar,detalles jsonb,planta_key varchar,ip_direccion varchar);
 INSERT INTO fg_perfil VALUES('ADMIN','Administrador',true);
 INSERT INTO fg_usuario VALUES('admin','ADMIN',true);
 INSERT INTO fg_permiso(clave,nombre,modulo) VALUES('MENU_USUARIOS','Usuarios','MENU'),('MENU_FACTURACION_PREPARACION','Preparación','MENU');
 INSERT INTO fg_perfil_permiso VALUES('ADMIN','MENU_USUARIOS');
 INSERT INTO fg_planta VALUES('98');`);
 for(const clave of vigentes)await db.query("INSERT INTO fg_permiso(clave,nombre,modulo) VALUES($1,$1,'MENU')",[clave]);
 const actor={username:'admin'};
 await service.crearPerfil({clave:'PRUEBA',nombre:'Prueba',visible:true,sedes:['98'],permisos:[...vigentes,'MENU_FACTURACION_PREPARACION']},actor);
 let asignadas=(await db.query("SELECT permiso_clave FROM fg_perfil_permiso WHERE perfil_clave='PRUEBA'")).rows.map(x=>x.permiso_clave);
 assert.deepEqual(asignadas.sort(),[...vigentes].sort());
 // Asignación histórica: el guardado no la borra antes de autorizar la migración.
 await db.query("INSERT INTO fg_perfil_permiso VALUES('PRUEBA','MENU_FACTURACION_PREPARACION')");
 await service.actualizarPerfil('PRUEBA',{nombre:'Editado',visible:true,sedes:['98'],permisos:vigentes},actor);
 assert.equal((await db.query("SELECT nombre FROM fg_perfil WHERE clave='PRUEBA'")).rows[0].nombre,'Editado');
 asignadas=(await db.query("SELECT permiso_clave FROM fg_perfil_permiso WHERE perfil_clave='PRUEBA'")).rows.map(x=>x.permiso_clave);
 assert.deepEqual(asignadas.sort(),[...vigentes,'MENU_FACTURACION_PREPARACION'].sort());
 assert.ok(!(await service.obtenerPermisos()).some(x=>x.clave==='MENU_FACTURACION_PREPARACION'));
 assert.ok((await service.obtenerPerfiles()).find(x=>x.clave==='PRUEBA').permisos.every(x=>x!=='MENU_FACTURACION_PREPARACION'));
 await assert.rejects(()=>service.crearPerfil({clave:'NO',nombre:'No',visible:true,sedes:[],permisos:vigentes},{username:'desconocido'}),e=>e.statusCode===403);
 }finally{await db.end();await admin.query(`DROP DATABASE ${nombre}`);await admin.end();}
});
