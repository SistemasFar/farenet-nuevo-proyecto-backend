'use strict';
// PostgreSQL real: sólo crea y escribe en una BD sintética de loopback.
process.env.NODE_ENV = 'test';
process.env.NUBEFACT_ENABLED = 'true';
process.env.NUBEFACT_ENVIRONMENT = 'DEMO';
process.env.NUBEFACT_CORRELATIVOS_V2_ENABLED = 'true';
process.env.NUBEFACT_TEST_DEMO_API_URL = 'https://nubefact.invalid/solo-prueba-local';
process.env.NUBEFACT_TEST_DEMO_TOKEN = 'FICTICIO-NO-UTILIZABLE';
process.env.NUBEFACT_TEST_DEMO_RUC = '20600695771';
const test = require('node:test');
const leerSeccionSql = require('./leer-seccion-sql');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');

test('Cortesía: pagos, rollback y payload con PostgreSQL real aislado', {
    skip: process.env.FAREGAS_TEST_PG !== '1'
}, async t => {
    const cfg = { host: '127.0.0.1', port: 55440, user: 'faregas_sandbox', database: 'postgres' };
    const admin = new Pool(cfg);
    const nombre = 'codex_cortesia_' + Date.now();
    await admin.query(`CREATE DATABASE ${nombre}`);
    await admin.end();
    const db = new Pool({ ...cfg, database: nombre });
    const id = require.resolve('../../../config/database');
    require.cache[id] = { id, filename: id, loaded: true, exports: db };
    const ctx = { username: 'cortesia_fixture', perfil_id: 'SISTEMAS', planta_key: 'TEST' };
    let server;
    try {
        for (const numero of ['000', '001', '008']) {
            await db.query(leerSeccionSql(numero));
        }
        await db.query(`
            INSERT INTO moneda(key,descripcion) VALUES('sol','SOLES');
            INSERT INTO formapago(key,descripcion) VALUES('contado','CONTADO');
            INSERT INTO tipocontado(key,descripcion) VALUES('efectivo','EFECTIVO');
            INSERT INTO fg_empresa(key,nombre,ruc,direccion) VALUES('TEST','EMPRESA FICTICIA','20600695771','DIRECCION FICTICIA');
            INSERT INTO fg_planta(key,nombre,empresa_key) VALUES('TEST','SEDE FICTICIA','TEST');
            INSERT INTO fg_usuario(username,user_type,contrasenha,perfil_id,estado)
                VALUES('cortesia_fixture','USUARIO','NO_UTILIZABLE','SISTEMAS',TRUE);
            INSERT INTO fg_usuario_planta VALUES('cortesia_fixture','TEST');
            INSERT INTO fg_perfil_planta VALUES('SISTEMAS','TEST');
            INSERT INTO fg_categoria_servicio(codigo,nombre) VALUES('GNV','GNV PRUEBAS');
            INSERT INTO fg_empresa_facturador(empresa_key,entorno,credencial_clave) VALUES('TEST','DEMO','TEST');
            INSERT INTO fg_serie_comprobante(planta_key,empresa_key,tipo_comprobante,serie,es_predeterminada,proveedor_emision,entorno_emision) VALUES('TEST','TEST','FACTURA','FCG1',true,'NUBEFACT','DEMO');
            INSERT INTO fg_descuento(id,tipo,codigo,nombre,activo,usuario_creacion,fecha_inicio,fecha_fin)
                VALUES(17,'CONVENIO','D_CONVENIO_a88137bb742f4157','DESCUENTO CERTIFICADO TALLER',true,'cortesia_fixture',CURRENT_TIMESTAMP-INTERVAL '1 day',CURRENT_TIMESTAMP+INTERVAL '1 day'),
                      (18,'CAMPANA','COMERCIAL_TEST','DESCUENTO COMERCIAL',true,'cortesia_fixture',CURRENT_TIMESTAMP-INTERVAL '1 day',CURRENT_TIMESTAMP+INTERVAL '1 day');
        `);
        const categoria = (await db.query("SELECT id FROM fg_categoria_servicio WHERE codigo='GNV'")).rows[0].id;
        const pf = (await db.query(`INSERT INTO fg_producto_facturacion(codigo_sku,descripcion,tipo_producto,unidad,precio_referencia,tipo_afectacion_igv,categoria_id,naturaleza_spot,sujeto_detraccion)
            VALUES('CORTESIA-TEST','CERTIFICACION GNV FICTICIA','Producto','ZZ',90,'10',$1,'SERVICIO',false) RETURNING id`, [categoria])).rows[0].id;
        const servicio = (await db.query(`INSERT INTO fg_servicio(codigo,nombre,familia,categoria_id,tipo_flujo,tipo_certificado_clave,modalidad)
            VALUES('CORTESIA-TEST','CERTIFICACION FICTICIA','GNV',$1,'CERTIFICACION','GNV_ANUAL','ANUAL') RETURNING id`, [categoria])).rows[0].id;
        await db.query(`INSERT INTO fg_tarifa(planta_key,codigo,familia,nombre,tipo_certificado_clave,modalidad,precio,servicio_id,producto_facturacion_id)
            VALUES('TEST','CORTESIA-TEST','GNV','PRUEBA','GNV_ANUAL','ANUAL',90,$1,$2)`, [servicio,pf]);
        const protegidoAntes = (await db.query("SELECT md5(string_agg(to_jsonb(u)::text, '' ORDER BY username)) AS hash FROM fg_usuario u")).rows[0].hash;
        const nuevoCertificado = async (descuentoId = null, descuentoImporte = 0) => {
            const c = (await db.query(`INSERT INTO fg_certificado(tipo_certificado_clave,planta_key,estado,usuario_creacion,tarifa_codigo,precio_certificado,producto_facturacion_certificado_id)
                VALUES('GNV_ANUAL','TEST','BORRADOR','cortesia_fixture','CORTESIA-TEST',90,$1) RETURNING id`, [pf])).rows[0].id;
            await db.query("INSERT INTO fg_certificado_vehiculo(certificado_id,placa) VALUES($1,'TEST001')", [c]);
            if(descuentoId) await db.query(`INSERT INTO fg_descuentocomprobante(descuento_id,certificado_id,importe_original,importe_descuento,importe_final,estado,reservado_hasta,usuario_creacion)
                VALUES($1,$2,90,$3,90::numeric-$3::numeric,'RESERVADO',CURRENT_TIMESTAMP+INTERVAL '1 day','cortesia_fixture')`, [descuentoId,c,descuentoImporte]);
            return c;
        };
        const pagos = require('../services/faregas-pagos.service');
        const counts = async () => (await db.query(`SELECT
            (SELECT count(*) FROM fg_orden_pago)::int AS ordenes,
            (SELECT count(*) FROM fg_pago)::int AS pagos,
            (SELECT count(*) FROM fg_operacion_comercial)::int AS operaciones,
            (SELECT count(*) FROM fg_operacion_detalle)::int AS detalles`)).rows[0];
        const guardar = (certificado, total, lista=[]) => pagos.guardarPagos(certificado, { importeTotal:total, condicionPago:'CONTADO', pagos:lista, tipoComprobante:'FACTURA' }, ctx);
        const cortesia = await nuevoCertificado(17,90);
        await t.test('reproduce primera sentencia 23503 y consecuencia 25P02 del código anterior', async () => {
            const c = await db.connect();
            try {
                await c.query('BEGIN');
                await assert.rejects(c.query('UPDATE fg_descuentocomprobante SET descuento_cliente_id = 30 WHERE certificado_id = $1 AND descuento_cliente_id IS NULL', [cortesia]), e => e.code === '23503' && e.constraint === 'fk_fg_descom_descli');
                await assert.rejects(c.query('SELECT * FROM fg_orden_pago WHERE certificado_id=$1 FOR UPDATE', [cortesia]), e => e.code === '25P02');
                await c.query('ROLLBACK');
                assert.equal((await c.query('SELECT 1 AS ok')).rows[0].ok,1);
            } finally { c.release(); }
        });
        await t.test('A: cortesía 90 → cero, sin pago ficticio, deuda ni código inventado', async () => {
            const r = await guardar(cortesia,0);
            assert.equal(Number(r.orden.importe_total),0);
            assert.equal(Number(r.orden.importe_pagado),0);
            assert.equal(Number(r.orden.saldo_pendiente),0);
            assert.equal(r.orden.estado,'PAGADO');
            assert.deepEqual(r.pagos,[]);
            assert.equal(r.resumenComercial.precioCertificado,90);
            assert.equal(r.resumenComercial.descuentoCertificado,90);
            const reserva = (await db.query('SELECT * FROM fg_descuentocomprobante WHERE certificado_id=$1',[cortesia])).rows[0];
            assert.equal(reserva.estado,'APLICADO');
            assert.equal(reserva.descuento_cliente_id,null);
            assert.ok(reserva.fecha_aplicacion);
            const n = await counts();
            await guardar(cortesia,0);
            assert.deepEqual(await counts(),n,'Reintento idempotente');
        });
        await t.test('B: cobro normal efectivo 90 e idempotencia', async () => {
            const c=await nuevoCertificado();
            const r=await guardar(c,90,[{tipo:'efectivo',importe:90}]);
            assert.equal(r.pagos.length,1);
            assert.equal(Number(r.pagos[0].importe),90);
            assert.equal(Number(r.orden.saldo_pendiente),0);
            const n=await counts();await guardar(c,90,[{tipo:'efectivo',importe:90}]);assert.deepEqual(await counts(),n);
        });
        await t.test('C: descuento comercial 20, cobro 70, no gratuidad', async () => {
            const c=await nuevoCertificado(18,20);const r=await guardar(c,70,[{tipo:'efectivo',importe:70}]);
            assert.equal(r.resumenComercial.descuentoCertificado,20);assert.equal(r.pagos.length,1);assert.equal(Number(r.orden.importe_total),70);
        });
        await t.test('D: error SQL posterior al INSERT de pago revierte orden, pago y operación y conserva BORRADOR', async () => {
            const c=await nuevoCertificado();const n=await counts();
            await db.query(`CREATE FUNCTION cortesia_error_controlado() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'PRUEBA AISLADA' USING ERRCODE='23514'; END; $$;
                CREATE TRIGGER cortesia_error_controlado BEFORE UPDATE ON fg_operacion_comercial FOR EACH ROW EXECUTE FUNCTION cortesia_error_controlado();`);
            await assert.rejects(guardar(c,90,[{tipo:'efectivo',importe:90}]),e=>e.code==='23514');
            assert.deepEqual(await counts(),n);
            assert.equal((await db.query('SELECT estado FROM fg_certificado WHERE id=$1',[c])).rows[0].estado,'BORRADOR');
            await db.query('DROP TRIGGER cortesia_error_controlado ON fg_operacion_comercial; DROP FUNCTION cortesia_error_controlado()');
            assert.equal((await guardar(c,90,[{tipo:'efectivo',importe:90}])).orden.estado,'PAGADO');
        });
        await t.test('rechaza cero sin autorización, pago cero y pago real en cortesía sin residuos',async()=>{
            const c=await nuevoCertificado();const n=await counts();
            await assert.rejects(guardar(c,0),/OPERACION_CERO_REQUIERE_AUTORIZACION_GRATUITA/);
            await assert.rejects(guardar(c,90,[{tipo:'efectivo',importe:0}]),/IMPORTE_PAGO_INVALIDO/);
            await assert.rejects(guardar(cortesia,0,[{tipo:'efectivo',importe:1}]),/CORTESIA_NO_ADMITE_PAGOS/);
            assert.deepEqual(await counts(),n);
        });
        await t.test('resumen fiscal real y payload conservan referencia 90 y exigible cero',async()=>{
            const fac=(await db.query(`INSERT INTO fg_facturacion(certificado_id,tipo_comprobante,tipo_documento_cliente,nro_documento,nombre_razon_social,direccion,base_imponible,igv,importe_total,usuario_creacion,serie,numero,fecha_documento)
                VALUES($1,'FACTURA','RUC','20600695771','CLIENTE FICTICIO','DIRECCION FICTICIA',0,0,0,'cortesia_fixture','FCG1',1,CURRENT_DATE) RETURNING *`,[cortesia])).rows[0];
            const rt=require('../services/faregas-resumen-tributario.service');
            const resumen=await rt.obtenerResumenTributario(cortesia,db);
            assert.equal(resumen.totales.precioAntesDescuento,90);assert.equal(resumen.totales.gratuita,90);assert.equal(resumen.totales.total,0);
            const payload=require('../integrations/nubefact-faregas.adapter').construirPayloadNubefact({facturacion:fac,certificado:{id:cortesia,tipo_certificado_clave:'GNV_ANUAL'},detalles:rt.construirDetallesNubefact(resumen),resumenTributario:resumen});
            assert.equal(payload.total_gratuita,90);assert.equal(payload.total,0);assert.equal(payload.total_descuento,0);assert.equal(payload.items[0].precio_unitario,90);assert.equal(payload.items[0].tipo_de_igv,6);assert.equal(payload.medio_de_pago,'');assert.match(payload.observaciones,/CORTESÍA — OPERACIÓN GRATUITA/);assert.equal(payload.leyendas,undefined);
            if(process.env.FAREGAS_CORTESIA_EVIDENCE_DIR){const dir=path.resolve(process.env.FAREGAS_CORTESIA_EVIDENCE_DIR);fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'payload-aislado.json'),JSON.stringify(payload,null,2));fs.writeFileSync(path.join(dir,'bd-aislada.json'),JSON.stringify({database:nombre,certificadoId:cortesia,facturacionId:fac.id,puerto:55440,sintetico:true},null,2));}
        });
        const protegidoDespues=(await db.query("SELECT md5(string_agg(to_jsonb(u)::text, '' ORDER BY username)) AS hash FROM fg_usuario u")).rows[0].hash;
        assert.equal(protegidoDespues,protegidoAntes,'No cambia usuarios ni sus credenciales');
    } finally {
        if(server) await new Promise(r=>server.close(r));
        await db.end();
        // Se conserva esta BD sintética independiente para inspección manual. No hay limpieza compartida.
    }
});
