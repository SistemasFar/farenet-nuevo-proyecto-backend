// Integración real de catálogo/HTTP/PostgreSQL. No carga .env ni llama a NubeFact.
process.env.NODE_ENV='test';process.env.JWT_SECRET_FAREGAS=require('crypto').randomBytes(40).toString('hex');
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),{Pool}=require('pg');
test('Productos fiscales → catálogo wizard → persistencia SPOT → payload existente (PostgreSQL aislado)',{skip:process.env.FAREGAS_TEST_PG!=='1'},async t=>{
 const cfg={host:'127.0.0.1',port:55440,user:'faregas_sandbox',database:'postgres'};const admin=new Pool(cfg),nombre='codex_spot_cierre_'+Date.now();await admin.query(`CREATE DATABASE ${nombre}`);const db=new Pool({...cfg,database:nombre});let server;
 const id=require.resolve('../../../config/database');require.cache[id]={id,filename:id,loaded:true,exports:db};
 try{
 await db.query(fs.readFileSync(path.join(__dirname,'../database/migrations/000_faregas_schema_completo.sql'),'utf8'));
 await db.query(fs.readFileSync(path.join(__dirname,'../database/migrations/001_faregas_datos_iniciales.sql'),'utf8'));
 await db.query(fs.readFileSync(path.join(__dirname,'../database/migrations/008_habilitar_naturaleza_fiscal_spot.sql'),'utf8'));
 await db.query(`INSERT INTO moneda(key,descripcion) VALUES('sol','SOLES');INSERT INTO fg_empresa(key,nombre) VALUES('TEST','EMPRESA FICTICIA');INSERT INTO fg_planta(key,nombre,empresa_key) VALUES('TEST','SEDE FICTICIA','TEST');INSERT INTO fg_usuario(username,user_type,contrasenha,perfil_id,estado) VALUES('spot_fixture','USUARIO','NO_UTILIZABLE','SISTEMAS',TRUE);INSERT INTO fg_usuario_planta VALUES('spot_fixture','TEST');INSERT INTO fg_perfil_planta VALUES('SISTEMAS','TEST');INSERT INTO fg_categoria_servicio(codigo,nombre) VALUES('GNV','GNV PRUEBAS');`);
 const categoria=(await db.query("SELECT id FROM fg_categoria_servicio WHERE codigo='GNV'")).rows[0].id;
 const express=require('express'),jwt=require('jsonwebtoken');const app=express();app.use(express.json());app.use('/api/faregas/config',require('../routes/faregas-config.routes'));server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const token=jwt.sign({username:'spot_fixture',perfil_id:'SISTEMAS',planta_key:'TEST',faregas_flow:'authenticated'},process.env.JWT_SECRET_FAREGAS);
 const base=`http://127.0.0.1:${server.address().port}/api/faregas/config`;
 const request=(url,body,method='POST')=>fetch(base+url,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
 const body={codigo_sku:'SPOT-UI-1260',descripcion:'CERTIFICACION FICTICIA',categoria_id:categoria,tipo_producto:'Producto',unidad:'ZZ',precio_referencia:1260,tipo_afectacion_igv:'10',naturaleza_spot:'SERVICIO',sujeto_detraccion:true,detraccion_codigo:'037',detraccion_porcentaje:12};
 const create=await request('/productos',body);const created=await create.json();assert.equal(create.status,201,JSON.stringify(created));const product=(await db.query('SELECT * FROM fg_producto_facturacion WHERE codigo_sku=$1',[body.codigo_sku])).rows[0];assert.equal(product.tipo_producto,'Producto');assert.equal(product.naturaleza_spot,'SERVICIO');assert.equal(product.detraccion_codigo,'037');
 await db.query(`INSERT INTO fg_servicio(codigo,nombre,familia,categoria_id,tipo_flujo,tipo_certificado_clave,modalidad) VALUES('SPOT-TEST','CERTIFICACION FICTICIA','GNV',$1,'CERTIFICACION','GNV_ANUAL','ANUAL')`,[categoria]);const servicio=(await db.query("SELECT id FROM fg_servicio WHERE codigo='SPOT-TEST'")).rows[0].id;
 await db.query(`INSERT INTO fg_tarifa(planta_key,codigo,familia,nombre,tipo_certificado_clave,modalidad,precio,servicio_id,producto_facturacion_id) VALUES('TEST','SPOT-TEST','GNV','PRUEBA','GNV_ANUAL','ANUAL',1260,$1,$2)`,[servicio,product.id]);
 const tarifas=require('../services/faregas-tarifas.service');const catalogo=await tarifas.obtenerCatalogoPorPlanta('TEST',db);const opcion=catalogo.categorias.flatMap(x=>x.servicios).find(x=>x.tarifa.codigo==='SPOT-TEST');assert.equal(opcion.spot.naturaleza,'SERVICIO');assert.equal(opcion.spot.sujetoDetraccion,true);assert.equal(opcion.spot.codigo,'037');assert.equal(opcion.spot.porcentaje,12);
 const cert=(await db.query(`INSERT INTO fg_certificado(tipo_certificado_clave,planta_key,estado,usuario_creacion,tarifa_codigo,precio_certificado,producto_facturacion_certificado_id) VALUES('GNV_ANUAL','TEST','BORRADOR','spot_fixture','SPOT-TEST',1260,$1) RETURNING id`,[product.id])).rows[0];
 const fac=(await db.query(`INSERT INTO fg_facturacion(certificado_id,tipo_comprobante,tipo_documento_cliente,nro_documento,nombre_razon_social,direccion,base_imponible,igv,importe_total,usuario_creacion) VALUES($1,'FACTURA','RUC','20000000001','CLIENTE FICTICIO','DIRECCION FICTICIA',1067.8,192.2,1260,'spot_fixture') RETURNING id`,[cert.id])).rows[0];
 const sync=require('../services/faregas-facturacion.service')._private.sincronizarDetraccionFacturacion;
 const evaluacion=await sync(db,fac.id,{tipoComprobante:'FACTURA',importeTotal:1260,moneda:'PEN'});assert.equal(evaluacion.sujeto,true);assert.equal(evaluacion.monto,151);assert.equal(evaluacion.neto,1109);
 const stored=(await db.query('SELECT * FROM fg_facturacion WHERE id=$1',[fac.id])).rows[0];assert.equal(Number(stored.importe_total),1260);assert.equal(Number(stored.detraccion_base),1260);assert.equal(Number(stored.detraccion_monto),151);assert.equal(Number(stored.detraccion_neto),1109);
 const {evaluarDetraccion,aplicarDetraccionPayloadNubefact}=require('../services/faregas-detracciones.service');
 const payload=require('../integrations/nubefact-faregas.adapter').construirPayloadNubefact({facturacion:stored,certificado:{tipo_certificado_clave:'GNV_ANUAL'},vehiculo:{placa:'TEST001'}});assert.equal(payload.total,1260);assert.equal(payload.detraccion_tipo,35);assert.equal(payload.detraccion_total,151);assert.equal(payload.detraccion_porcentaje,12);
 for(const [name,datos,esperado] of [
 ['chips1080',{tipoComprobante:'FACTURA',importeTotal:1080,items:[{tipo_item:'PRODUCTO',productoSpot:{naturaleza_spot:'BIEN',sujeto_detraccion:false}}]},false],
 ['factura ordinaria',{tipoComprobante:'FACTURA',importeTotal:1260,servicio:{sujeto_detraccion:false}},false],
 ['boleta',{tipoComprobante:'BOLETA',importeTotal:1260,servicio:product},false],
 ['bajo umbral',{tipoComprobante:'FACTURA',importeTotal:700,servicio:product},false],
 ['GNV/GLP con chip bajo umbral',{tipoComprobante:'FACTURA',importeTotal:160,items:[{tipo_item:'SERVICIO'},{tipo_item:'PRODUCTO'}]},false],
 ['Producto comercial/Servicio fiscal',{tipoComprobante:'FACTURA',importeTotal:1260,items:[{tipo_item:'PRODUCTO',productoSpot:product}]},true]]){
 await t.test(name,()=>{const r=evaluarDetraccion(datos);assert.equal(r.sujeto,esperado);assert.equal(r.requiereRevision,false);});}
 const op=(await db.query("INSERT INTO fg_operacion_comercial(planta_key,moneda_key,importe_total,usuario_creacion) VALUES('TEST','sol',1260,'spot_fixture') RETURNING id")).rows[0].id;
 await db.query("INSERT INTO fg_operacion_detalle(operacion_id,tipo_item,producto_facturacion_id,cantidad,descripcion_snapshot,unidad_snapshot,afectacion_igv_snapshot,valor_unitario,precio_unitario,base_imponible,igv,importe_total,orden) VALUES($1,'PRODUCTO',$2,1,'SERVICIO COMERCIALIZADO COMO PRODUCTO','ZZ','10',1067.8,1260,1067.8,192.2,1260,1)",[op,product.id]);
 const porOperacion=await sync(db,fac.id,{tipoComprobante:'FACTURA',importeTotal:1260,moneda:'PEN',operacionId:op});assert.equal(porOperacion.sujeto,true);assert.equal(porOperacion.codigo,'037');assert.equal(porOperacion.neto,1109);
 for(const tipo of ['GNV_ANUAL','GLP_ANUAL']){const ordinario=require('../integrations/nubefact-faregas.adapter').construirPayloadNubefact({facturacion:{...stored,sujeto_detraccion:false},certificado:{tipo_certificado_clave:tipo},vehiculo:{placa:'TEST001'}});assert.equal(ordinario.total,1260);assert.ok(!ordinario.detraccion);}
 await db.query("INSERT INTO formapago(key) VALUES('contado'),('credito');INSERT INTO tipocontado(key) VALUES('efectivo')");
 const pagosService=require('../services/faregas-pagos.service');
 for(const recibido of [500,1109]){
  await pagosService.guardarPagos(cert.id,{importeTotal:1260,condicionPago:'CONTADO',pagos:[{tipo:'EFECTIVO',importe:recibido}]},{username:'spot_fixture',perfil_id:'SISTEMAS',planta_key:'TEST'});
  const orden=(await db.query('SELECT importe_total,importe_pagado,saldo_pendiente FROM fg_orden_pago WHERE certificado_id=$1',[cert.id])).rows[0];
  assert.equal(Number(orden.importe_total),1260);assert.equal(Number(orden.importe_pagado),recibido);assert.equal(Number(orden.saldo_pendiente),1109-recibido);
 }
 // Validar ausencia de cualquier documento emitido/intento/proveedor; no series ni correlativos reservados.
 assert.equal((await db.query("SELECT count(*)::int n FROM fg_facturacion WHERE estado<>'BORRADOR' OR serie IS NOT NULL OR numero IS NOT NULL")).rows[0].n,0);
 assert.equal((await db.query('SELECT count(*)::int n FROM fg_facturacion_intento')).rows[0].n,0);
 }finally{if(server)await new Promise(r=>server.close(r));await db.end();await admin.query(`DROP DATABASE ${nombre}`);await admin.end();}
});
