const test=require('node:test');const assert=require('node:assert/strict');
process.env.NODE_ENV='test';process.env.JWT_SECRET_FAREGAS=require('node:crypto').randomBytes(32).toString('hex');
let perfil='OPERADOR',activo=true,global=false,permisos=[],sedes=['98'],queries=[];
const row=()=>({certificado_id:10,certificado_estado:'EMITIDO',numero_certificado:'DG-TEST',tipo_certificado_clave:'GLP_ANUAL',planta_key:'98',empresa_key:'TEST',facturacion_id:20,tipo_comprobante:'BOLETA',facturacion_estado:'ACEPTADO',aceptada_sunat:true,proveedor:'NUBEFACT',entorno_facturador:'PRODUCCION',nro_comprobante:'BTEST-1',serie:'BTEST',numero:1,fecha_documento:'2020-01-01',importe_total:80,moneda_key:'PEN'});
const result=(rows=[])=>({rows,rowCount:rows.length});
const fake={query:async(sql,args=[])=>{sql=typeof sql==='string'?sql:sql.text;queries.push({sql,args});
 if(/^(BEGIN|COMMIT|ROLLBACK)/.test(sql))return result();
 if(/FROM (?:public\.)?fg_usuario\b/.test(sql))return result([{username:'test',perfil_id:perfil,estado:activo}]);
 if(/SELECT TRUE AS acceso_global/.test(sql))return result();
 if(/FROM (?:public\.)?fg_perfil_permiso/.test(sql)){let filas=[...permisos,...(global?['DASHBOARD_GLOBAL']:[])].map(permiso_clave=>({permiso_clave}));const requerido=sql.match(/permiso_clave\s*=\s*'([^']+)'/i)?.[1];if(requerido)filas=filas.filter(f=>f.permiso_clave===requerido);return result(filas);}
 if(/FROM fg_usuario_planta/.test(sql))return result(sedes.map(key=>({key,nombre:key,empresa_key:'TEST'})));
 if(/FROM fg_certificado c/.test(sql))return result([row()]);
 if(/FROM fg_solicitud_operacion s/.test(sql))return result([{...row(),id:1,tipo_operacion:'EMITIR_NOTA_CREDITO',estado:'PENDIENTE_APROBACION',usuario_solicitante:'test',version:1}]);
 if(/INSERT INTO fg_solicitud_operacion \(/.test(sql))return result([{id:1,tipo_operacion:args[0],certificado_id:args[1],facturacion_id:args[2],empresa_key:args[3],planta_key:args[4],usuario_solicitante:args[5],motivo:args[6],estado:'PENDIENTE_APROBACION',version:1,datos_propuestos:JSON.parse(args[10])}]);
 if(/INSERT INTO fg_solicitud_operacion_evento/.test(sql))return result();
 if(/FROM fg_solicitud_operacion|FROM fg_documento_anulacion|FROM fg_credito/.test(sql))return result();
 throw new Error('SQL no previsto: '+sql.slice(0,160));
},connect:async()=>({...fake,release(){}})};
const dbPath=require.resolve('../../../config/database');require.cache[dbPath]={id:dbPath,filename:dbPath,loaded:true,exports:fake};
const stub=(file,exports)=>{const id=require.resolve(file);require.cache[id]={id,filename:id,loaded:true,exports};};
stub('../services/faregas-notificaciones.service',{crearParaAutorizacionNotaCredito:async()=>{}});
stub('../services/faregas-certificados.service',{obtenerSnapshotCompletoCertificado:async()=>({})});
const {resolverPlantasAutorizadas}=require('../services/faregas-dashboard-acceso.service');
const {crearServicio}=require('../services/faregas-solicitudes-operacion.service')._private;
let workerCalls=0;const solicitudes=crearServicio(fake,{notasCreditoWorker:new Proxy({}, {get:()=>()=>{workerCalls++;throw Error('NO DOCUMENTOS FISCALES');}})});
const req=(query={})=>({user:{username:'test',perfil_id:'ANTIGUO',faregas_flow:'authenticated',planta_key:'98'},query});
const reset=()=>{perfil='OPERADOR';activo=true;global=false;permisos=[];sedes=['98'];queries=[];workerCalls=0;};
test('lectura básica y solicitud pendiente universales, sin aprobación ni emisión',async t=>{
 for(const nombre of ['OPERADOR','CONTADOR','SISTEMAS'])await t.test(nombre,async()=>{reset();perfil=nombre;permisos=['MENU_DASHBOARD'];
  const r=req();const acceso=await resolverPlantasAutorizadas(r,fake);assert.deepEqual(acceso.plantasFiltro,['98']);assert.equal(r.user.perfil_id,nombre);
  const contexto=await solicitudes.contextoCertificado(10,r.user,{tipoOperacion:'EMITIR_NOTA_CREDITO'});assert.deepEqual(contexto.tiposDisponibles,['EMITIR_NOTA_CREDITO']);
  const res=await solicitudes.crearAutorizacionNotaCredito({certificadoId:10,tipoOperacion:'EMITIR_NOTA_CREDITO',motivo:'Corrección solicitada',idempotenciaClave:require('node:crypto').randomUUID(),datosPropuestos:{motivoCodigo:'01'}},r.user);
  assert.equal(res.solicitud.estado,'PENDIENTE_APROBACION');assert.equal(res.creada,true);assert.equal(workerCalls,0);
  const writes=queries.filter(x=>/^\s*(INSERT|UPDATE|DELETE)/i.test(x.sql));assert.equal(writes.length,2);assert.ok(writes.every(x=>/INSERT INTO fg_solicitud_operacion/.test(x.sql)));
  await assert.rejects(()=>solicitudes.aprobar(1,{version:1},r.user),e=>e.statusCode===403);
  await assert.rejects(()=>solicitudes.crearAnulacionTotal({certificadoId:10,tipoOperacion:'ANULAR_AMBOS'},r.user),e=>e.statusCode===403);
 });
});
test('Dashboard: sin sesión, inactivo, preselección y sede ajena bloqueados',async()=>{reset();await assert.rejects(()=>resolverPlantasAutorizadas({query:{}},fake),e=>e.status===401);
 activo=false;await assert.rejects(()=>resolverPlantasAutorizadas(req(),fake),e=>e.status===403);activo=true;
 await assert.rejects(()=>resolverPlantasAutorizadas(req(),fake),e=>e.status===403 && e.message.includes('permiso'));
 permisos=['DASHBOARD_SEDE'];assert.deepEqual((await resolverPlantasAutorizadas(req(),fake)).plantasFiltro,['98']);
 permisos=[];
 const r=req();r.user.faregas_flow='pre-select';await assert.rejects(()=>resolverPlantasAutorizadas(r,fake),e=>e.status===403);
 for(const query of [{alcance:'GLOBAL'},{plantaKey:'99'},{plantas:'98,99'},{plantaKey:'98',plantas:'99'}])await assert.rejects(()=>resolverPlantasAutorizadas(req(query),fake),e=>e.status===403);
});
test('Dashboard GLOBAL nunca incluye sedes no autorizadas',async()=>{reset();global=true;sedes=['98','99'];assert.deepEqual((await resolverPlantasAutorizadas(req(),fake)).plantasFiltro,['98','99']);await assert.rejects(()=>resolverPlantasAutorizadas(req({plantas:'100'}),fake),e=>e.status===403);});
test('Solicitudes: usuario inactivo y sede no asignada no pueden solicitar',async()=>{reset();activo=false;await assert.rejects(()=>solicitudes.contextoCertificado(10,req().user,{tipoOperacion:'EMITIR_NOTA_CREDITO'}),e=>e.statusCode===403);activo=true;sedes=['99'];await assert.rejects(()=>solicitudes.crearAutorizacionNotaCredito({certificadoId:10,tipoOperacion:'EMITIR_NOTA_CREDITO',motivo:'Prueba',idempotenciaClave:require('node:crypto').randomUUID(),datosPropuestos:{motivoCodigo:'01'}},req().user),e=>e.statusCode===403);assert.equal(workerCalls,0);});
// API HTTP real, autenticación real y controlador real; indicadores aislados con fixture.
let filtros;
stub('../services/faregas-dashboard.service',{obtenerResumenDashboard:async f=>{filtros=f;return {sede:f.plantasFiltro};}});
const express=require('express');const jwt=require('jsonwebtoken');
test('API Dashboard: 200 por perfil, 401 sin sesión, 403 inactivo/ajeno/exportación',async()=>{reset();const app=express();app.use('/dashboard',require('../routes/faregas-dashboard.routes'));const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 try {const base=`http://127.0.0.1:${server.address().port}/dashboard`;const token=jwt.sign(req().user,process.env.JWT_SECRET_FAREGAS);const get=(path,auth=true)=>fetch(base+path,{headers:auth?{Authorization:`Bearer ${token}`}:{}});
 assert.equal((await get('/resumen')).status,403);
 for(const nombre of ['CONTADOR','OPERADOR','SISTEMAS']){perfil=nombre;permisos=['MENU_DASHBOARD'];const res=await get('/resumen');assert.equal(res.status,200);assert.deepEqual(filtros.plantasFiltro,['98']);}
 assert.equal((await get('/resumen',false)).status,401);activo=false;assert.equal((await get('/resumen')).status,403);activo=true;
 assert.equal((await get('/resumen?plantaKey=99')).status,403);assert.equal((await get('/exportacion')).status,403);
 }finally{await new Promise(resolve=>server.close(resolve));}
});

test('API certificados usa el perfil vigente de PostgreSQL cuando el JWT está desactualizado',async()=>{
 reset();perfil='CONTADOR';permisos=['MENU_INICIO'];
 const responder=(req,res)=>res.json({perfilId:req.user.perfil_id});
 const controlador=new Proxy({}, {get:()=>responder});
 stub('../controllers/faregas-certificados.controller',controlador);
 stub('../controllers/faregas-certificados-correlativos.controller',controlador);
 stub('../controllers/faregas-pagos.controller',controlador);
 stub('../controllers/faregas-facturacion.controller',controlador);
 stub('../controllers/faregas-documentos-electronicos.controller',controlador);
 stub('../controllers/faregas-facturacion-admin.controller',controlador);
 stub('../controllers/faregas-nubefact-readiness.controller',controlador);
 const rutaId=require.resolve('../routes/faregas-certificados.routes');
 delete require.cache[rutaId];
 const app=express();app.use('/certificados',require('../routes/faregas-certificados.routes'));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 try{
  const staleToken=jwt.sign({...req().user,perfil_id:'OPERADOR'},process.env.JWT_SECRET_FAREGAS);
  const response=await fetch(`http://127.0.0.1:${server.address().port}/certificados/tipos`,{headers:{Authorization:`Bearer ${staleToken}`}});
  const responseText=await response.text();
  assert.equal(response.status,200,responseText);assert.deepEqual(JSON.parse(responseText),{perfilId:'CONTADOR'});
  permisos=[];
  const sinModulo=await fetch(`http://127.0.0.1:${server.address().port}/certificados/tipos`,{headers:{Authorization:`Bearer ${staleToken}`}});
  assert.equal(sinModulo.status,403);
  permisos=['MENU_INICIO'];
  const adminSinComprobantes=await fetch(`http://127.0.0.1:${server.address().port}/certificados/facturacion/admin/documentos`,{headers:{Authorization:`Bearer ${staleToken}`}});
  assert.equal(adminSinComprobantes.status,403);
  permisos=['MENU_FACTURACION_COMPROBANTES'];
  const adminConComprobantes=await fetch(`http://127.0.0.1:${server.address().port}/certificados/facturacion/admin/documentos`,{headers:{Authorization:`Bearer ${staleToken}`}});
  assert.equal(adminConComprobantes.status,200);
  permisos=['MENU_CONFIGURACION_CORRELATIVOS'];
  const correlativosConfig=await fetch(`http://127.0.0.1:${server.address().port}/certificados/correlativos-sede`,{headers:{Authorization:`Bearer ${staleToken}`}});
  assert.equal(correlativosConfig.status,200);
  permisos=['MENU_FACTURACION_SERIES'];
  const correlativosConSerie=await fetch(`http://127.0.0.1:${server.address().port}/certificados/correlativos-sede`,{headers:{Authorization:`Bearer ${staleToken}`}});
  assert.equal(correlativosConSerie.status,200);
  permisos=['MENU_FACTURACION'];
  const correlativosSoloConPadre=await fetch(`http://127.0.0.1:${server.address().port}/certificados/correlativos-sede`,{headers:{Authorization:`Bearer ${staleToken}`}});
  assert.equal(correlativosSoloConPadre.status,403);
 }finally{
  await new Promise(resolve=>server.close(resolve));
  delete require.cache[rutaId];
 }
});

test('API HTTP de chips permite las operaciones ordinarias del submódulo y conserva acciones sensibles',async()=>{
 reset();perfil='CONTADOR';permisos=['MENU_CHIPS_VENTAS'];
 const responder=(req,res)=>res.json({perfilId:req.user.perfil_id});
 const controlador=new Proxy({}, {get:()=>responder});
 stub('../controllers/faregas-chips.controller',controlador);
 stub('../controllers/faregas-documentos-electronicos.controller',controlador);
 const rutaId=require.resolve('../routes/faregas-chips.routes');delete require.cache[rutaId];
 const app=express();app.use(express.json());app.use('/chips',require('../routes/faregas-chips.routes'));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 try{
  const token=jwt.sign(req().user,process.env.JWT_SECRET_FAREGAS);
  const base=`http://127.0.0.1:${server.address().port}/chips`;
  const get=path=>fetch(base+path,{headers:{Authorization:`Bearer ${token}`}});
  const post=path=>fetch(base+path,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:'{}'});
  const listResponse=await get('/ventas');
  assert.equal(listResponse.status,200,await listResponse.text());
  assert.equal((await post('/ventas')).status,200);
  assert.equal((await post('/ventas/1/facturacion/anulaciones')).status,403);
  permisos=['CHIPS_VER','CHIPS_VENDER'];
  assert.equal((await get('/ventas')).status,403);
 }finally{await new Promise(resolve=>server.close(resolve));delete require.cache[rutaId];}
});

test('consultar una solicitud propia no concede aprobación específica de nota',async()=>{reset();permisos=['FAREGAS_SOLICITUD_VER'];await assert.rejects(()=>solicitudes.aprobar(1,{version:1},req().user),e=>e.code==='SOLICITUD_PERMISO_DENEGADO' && e.statusCode===403);assert.equal(workerCalls,0);assert.ok(!queries.some(x=>/UPDATE fg_solicitud_operacion/.test(x.sql)));});
test('emisor fiscal conserva su validación de permiso explícito',async()=>{reset();const fiscal=require('../services/faregas-documentos-electronicos.service');await assert.rejects(()=>fiscal._private.validarPermisoNotaCredito(fake,req().user),e=>e.code==='PERMISO_DENEGADO_NOTA_CREDITO' && e.statusCode===403);assert.ok(!queries.some(x=>/^\s*(INSERT|UPDATE|DELETE)/i.test(x.sql)));});
// Contrato compartido: impedir que el editor y el backend diverjan al retirar claves.
test('catálogos frontend/backend reconocen las mismas claves obsoletas',()=>{
 const fs=require('node:fs'),path=require('node:path');
 const source=fs.readFileSync(path.resolve(__dirname,'../../../../farenetFrontend/src/modules/faregas/views/Usuarios/permisosSensibles.ts'),'utf8');
 const bloque=source.match(/export const PERMISOS_OBSOLETOS = \[([\s\S]*?)\]/)[1];
 const claves=[...bloque.matchAll(/'([^']+)'/g)].map(x=>x[1]);
 assert.deepEqual(claves,require('../services/faregas-permisos-sensibles.constants').PERMISOS_OBSOLETOS);
});
test('API solicitudes: perfiles activos crean pendiente; sin sesión/inactivo/sede ajena quedan bloqueados',async()=>{
 reset();const audit=[];stub('../services/faregas-auditoria.service',{contextoRequest:(_req,data)=>data,registrarEvento:async data=>audit.push(data)});
 const app=express();app.use(express.json());app.use('/solicitudes',require('../routes/faregas-solicitudes-operacion.routes'));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 try{const token=jwt.sign(req().user,process.env.JWT_SECRET_FAREGAS);const base=`http://127.0.0.1:${server.address().port}/solicitudes`;
 const post=(auth=true)=>fetch(base,{method:'POST',headers:{'Content-Type':'application/json',...(auth?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify({certificadoId:10,tipoOperacion:'EMITIR_NOTA_CREDITO',motivo:'Sustento de prueba',datosPropuestos:{motivoCodigo:'01'},idempotenciaClave:require('node:crypto').randomUUID()})});
 for(const nombre of ['OPERADOR','CONTADOR','SISTEMAS']){perfil=nombre;const response=await post();assert.equal(response.status,201);assert.equal((await response.json()).data.estado,'PENDIENTE_APROBACION');}
 assert.equal(audit.length,3);assert.ok(audit.every(x=>x.evento==='SOLICITUD_CREADA'));assert.equal(workerCalls,0);
 assert.equal((await post(false)).status,401);activo=false;assert.equal((await post()).status,403);activo=true;sedes=['99'];assert.equal((await post()).status,403);
 }finally{await new Promise(r=>server.close(r));}
});
