const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');

const testUrl = process.env.FAREGAS_CONTINGENCIA_TEST_URL;

test('contingencia DEMO sobre un esquema PostgreSQL aislado', { skip: !testUrl }, async (t) => {
    const target = new URL(testUrl);
    assert.equal(target.protocol, 'postgresql:');
    assert.equal(target.hostname, '127.0.0.1');
    assert.equal(target.pathname, '/faregas_contingencia_test');
    assert.ok(Number(target.port) >= 65000, 'Use el clúster de pruebas temporal');
    Object.assign(process.env, {
        NODE_ENV: 'test',
        APP_DATABASE_ENVIRONMENT: 'DESARROLLO',
        NUBEFACT_ENABLED: 'true',
        NUBEFACT_ENVIRONMENT: 'DEMO',
        NUBEFACT_ENVIAR_CLIENTE: 'false',
        FAREGAS_CONTINGENCIA_ENABLED: 'true',
        FAREGAS_CONTINGENCIA_DB_NAME: 'faregas_contingencia_test',
        FAREGAS_CONTINGENCIA_TIPOS_DEMO: 'GLP_ANUAL:',
        FAREGAS_CONTINGENCIA_OPERADORES_DEMO: 'operador_mock',
        DB_HOST: target.hostname, DB_PORT: target.port, DB_USER: target.username,
        DB_NAME: 'faregas_contingencia_test', DB_PASSWORD: target.password || 'solo-local'
    });

    const pool = require('../../../config/database');
    const config = require('../../../config/integrations.config');
    const cont = require('../services/faregas-contingencia.service');
    const fiscal = require('../services/faregas-contingencia-worker.service');
    const auth = require('../services/faregas-auth.service');
    const certs = require('../services/faregas-certificados.service');
    t.after(() => pool.end());
    assert.equal(config.contingencia.habilitada, true);

    const sufijo = randomUUID().slice(0, 6);
    const empresa = 'D-' + sufijo;
    const sede = 'S-' + sufijo;
    const ruc = '20' + String(parseInt(sufijo, 16)).padStart(9, '0');
    const usuario = { username: 'operador_mock', perfil_id: 'PRUEBA' };
    const plazo = "(now() AT TIME ZONE 'America/Lima')::date";
    // Solo una referencia sintética inactiva para las FK en la base temporal.
    await pool.query("INSERT INTO public.fg_usuario (username,user_type,contrasenha,estado) VALUES ($1,'USER','FIXTURE_NO_LOGIN',false) ON CONFLICT DO NOTHING", [usuario.username]);
    await pool.query("INSERT INTO public.moneda (key,descripcion) VALUES ('sol','Soles') ON CONFLICT DO NOTHING");
    await pool.query("INSERT INTO public.formapago (key,descripcion) VALUES ('contado','Contado') ON CONFLICT DO NOTHING");
    await pool.query("INSERT INTO public.fg_empresa (key,nombre,ruc) VALUES ($1,'Empresa sintética',$2)", [empresa, ruc]);
    await pool.query("INSERT INTO public.fg_planta (key,nombre,empresa_key) VALUES ($1,'Sede sintética',$2)", [sede, empresa]);
    await pool.query("INSERT INTO public.fg_tipo_certificado (clave,nombre,codigo) VALUES ('GLP_ANUAL','GLP de prueba','41') ON CONFLICT DO NOTHING");

    const estado = async (factura) => (
        await pool.query("SELECT j.*,f.estado AS fiscal FROM public.fg_facturacion_contingencia j JOIN public.fg_facturacion f ON f.id=j.facturacion_id WHERE j.facturacion_id=$1", [factura.id])
    ).rows[0];
    const ausente = { httpStatus: 400, status: 'REJECTED', data: { errors: 'Documento no existe' } };
    const aceptada = (doc) => ({ httpStatus: 200, status: 'ACCEPTED', data: {
        serie: doc.serie, numero: doc.numero, tipo_de_comprobante: doc.tipo_de_comprobante,
        ruc_emisor: ruc, enlace_del_pdf: 'https://www.nubefact.com/pdf/mock',
        enlace_del_xml: 'https://www.nubefact.com/xml/mock', enlace_del_cdr: 'https://www.nubefact.com/cdr/mock',
        sunat_responsecode: '0'
    } });
    const deps = (consultarComprobante, emitirComprobante, enviar = async () => ({ referencia: 'correo-mock' })) => ({
        proveedor: { consultarComprobante, emitirComprobante },
        emisor: { resolverParaPlanta: async () => ({ environment: 'DEMO', empresaKey: empresa, rucEmisor: ruc, credentials: {} }) },
        correo: { enviar }
    });
    const noEmitir = async () => { throw Error('No debe hacer POST de emisión'); };

    const armar = async ({ emitido = true, email = null, cola = true } = {}) => {
        const seq = Number((await pool.query("SELECT nextval(pg_get_serial_sequence('public.fg_facturacion','id')) AS id")).rows[0].id);
        const numero = seq + 10000;
        const cert = (await pool.query(
            "INSERT INTO public.fg_certificado (tipo_certificado_clave,planta_key,usuario_creacion,estado,numero_certificado) " +
            "VALUES ('GLP_ANUAL',$1,$2,$3,$4) RETURNING id",
            [sede, usuario.username, emitido ? 'EMITIDO' : 'BORRADOR', 'TEST-DEMO-' + numero]
        )).rows[0];
        const operacion = (await pool.query("INSERT INTO public.fg_operacion_comercial (planta_key,usuario_creacion,estado,importe_total) " +
            "VALUES ($1,$2,'PAGADO',100) RETURNING id", [sede, usuario.username])).rows[0].id;
        const orden = (await pool.query("INSERT INTO public.fg_orden_pago (certificado_id,operacion_id,importe_total,baseimponible,igv," +
            "importe_pagado,saldo_pendiente,estado,usuariocreacion_username) VALUES ($1,$2,100,84.75,15.25,100,0,'PAGADO',$3) RETURNING *",
            [cert.id, operacion, usuario.username])).rows[0];
        const factura = (await pool.query(
            "INSERT INTO public.fg_facturacion (certificado_id,operacion_id,tipo_comprobante,tipo_documento_cliente,nro_documento," +
            "nombre_razon_social,direccion,base_imponible,igv,importe_total,usuario_creacion,planta_key,empresa_key,ruc_emisor," +
            "email,serie,numero,nro_comprobante,codigo_unico,fecha_documento,estado,entorno_facturador,intentos) " +
            "VALUES ($1,$2,'FACTURA','RUC','20000000001','Cliente sintético','Dirección de prueba',84.75,15.25,100,$3,$4,$5,$6," +
            "$7,'FD99',$8,$9,$10," + plazo + ",$11,'DEMO',1) RETURNING *",
            [cert.id, operacion, usuario.username, sede, empresa, ruc, email, numero, 'FD99-' + numero, 'FG-' + seq, cola ? 'PENDIENTE' : 'ERROR']
        )).rows[0];
        const payload = { operacion: 'generar_comprobante', serie: 'FD99', numero, tipo_de_comprobante: 1, codigo_unico: factura.codigo_unico };
        const diag = { categoria: 'TIMEOUT', recuperable: true, ausenciaConfirmada: true, seguimiento: 'TEST' };
        const intentoId = (await pool.query(
            "INSERT INTO public.fg_facturacion_intento (facturacion_id,numero_intento,estado,solicitud,respuesta) VALUES " +
            "($1,1,'ERROR',$2::jsonb,$3::jsonb) RETURNING id",
            [factura.id, JSON.stringify(payload), JSON.stringify({ _faregas_contingencia: diag })]
        )).rows[0].id;
        if (cola) await pool.query(
            "INSERT INTO public.fg_facturacion_contingencia (facturacion_id,certificado_id,operacion_id,intento_origen_id," +
            "planta_key,empresa_key,usuario_autorizacion,fecha_fiscal_original,diagnostico) VALUES ($1,$2,$3,$4,$5,$6,$7," + plazo + ",$8::jsonb)",
            [factura.id, cert.id, operacion, intentoId, sede, empresa, usuario.username, JSON.stringify(diag)]
        );
        return { factura, cert, payload, orden, operacion };
    };

    await t.test('autoriza únicamente a la sede y al operador habilitados, emite una vez y conserva el pago', async () => {
        const row = await armar({ emitido: false, cola: false });
        t.mock.method(auth, 'validarAccesoPlanta', async (username) => username === 'sin_sede' ? null : { key: sede });
        t.mock.method(auth, 'getPlantasPorUsuario', async () => [{ key: sede }]);
        t.mock.method(certs, 'validarEmision', async () => ({ valido: true }));
        t.mock.method(certs, 'obtenerBorradorCompleto', async () => ({ tipo: {} }));
        assert.equal((await cont.obtenerContexto(row.cert.id, usuario)).permiteSoloCertificado, true);
        await assert.rejects(cont.obtenerContexto(row.cert.id, { ...usuario, username: 'sin_sede' }), { code: 'PLANTA_NO_AUTORIZADA' });
        await assert.rejects(certs.emitirCertificado(row.cert.id, { ...usuario, username: 'otro' }, { contingencia: true }),
            { code: 'OPERADOR_CONTINGENCIA_NO_AUTORIZADO' });
        const salida = await certs.emitirCertificado(row.cert.id, usuario, { contingencia: true });
        assert.equal(salida.estadoRegularizacion, 'PENDIENTE');
        assert.equal((await certs.emitirCertificado(row.cert.id, usuario, { contingencia: true })).recuperado, true);
        assert.equal((await estado(row.factura)).fiscal, 'PENDIENTE');
        const pagoActual = (await pool.query('SELECT * FROM public.fg_orden_pago WHERE id=$1', [row.orden.id])).rows[0];
        assert.deepEqual(pagoActual, row.orden);
    });

    await t.test('dos trabajadores concurrentes consultan y emiten una vez con la serie y el número originales', async () => {
        const row = await armar({ email: 'cliente@example.test' });
        const eventos = [];
        const simulacion = deps(async () => { eventos.push('consulta'); return ausente; }, async (payload) => {
            eventos.push('emision');
            assert.equal(payload.codigo_unico, row.payload.codigo_unico);
            assert.equal(payload.numero, row.payload.numero);
            assert.equal(payload.enviar_automaticamente_al_cliente, false);
            return aceptada(payload);
        }, async () => { eventos.push('entrega'); return { referencia: 'demo-1' }; });
        const concurrentes = await Promise.all([
            fiscal.procesarLote({ facturacionId: row.factura.id }, simulacion),
            fiscal.procesarLote({ facturacionId: row.factura.id }, simulacion)
        ]);
        assert.equal(concurrentes.reduce((s, item) => s + item.reclamados, 0), 1);
        assert.deepEqual(eventos, ['consulta', 'emision', 'entrega']);
        const final = await estado(row.factura);
        assert.equal(final.estado, 'REGULARIZADO');
        assert.equal(final.correo_estado, 'ENVIADO');
        assert.equal(final.fiscal, 'ACEPTADO');
        const ordenDespues = (await pool.query('SELECT * FROM public.fg_orden_pago WHERE id=$1', [row.orden.id])).rows[0];
        assert.deepEqual(ordenDespues, row.orden);
    });

    await t.test('recupera un resultado remoto tras una reserva vencida y omite correo si falta dirección', async () => {
        const row = await armar();
        await pool.query("UPDATE public.fg_facturacion_contingencia SET lease_token=$2,lease_hasta=now()-interval '1 minute' WHERE facturacion_id=$1",
            [row.factura.id, randomUUID()]);
        const script = [
            "const db = require('./config/database');",
            "const { procesarLote } = require('./modules/faregas/services/faregas-contingencia-worker.service');",
            'const fixture = ' + JSON.stringify({ factura: row.factura.id, respuesta: aceptada(row.payload), empresa, ruc }) + ';',
            'procesarLote({ facturacionId: fixture.factura }, {',
            '  emisor: { resolverParaPlanta: async () => ({ environment: "DEMO", empresaKey: fixture.empresa, rucEmisor: fixture.ruc }) },',
            '  proveedor: { consultarComprobante: async () => fixture.respuesta, emitirComprobante: async () => { throw Error("POST inesperado"); } },',
            '  correo: { enviar: async () => { throw Error("Correo inesperado"); } }',
            '}).then(resultado => { console.log(JSON.stringify(resultado)); }).finally(() => db.end());'
        ].join('\n');
        const stdout = execFileSync(process.execPath, ['-e', script], { cwd: require('node:path').resolve(__dirname, '..', '..', '..'), encoding: 'utf8' });
        assert.equal(JSON.parse(stdout).errores, 0);
        const final = await estado(row.factura);
        assert.equal(final.estado, 'REGULARIZADO');
        assert.equal(final.correo_estado, 'SIN_CORREO');
        assert.equal(final.correo_intentos, 0);
    });

    await t.test('el correo temporalmente fallido se reintenta sin volver a emitir el comprobante', async () => {
        const row = await armar({ email: 'cliente@example.test' });
        let correos = 0;
        const simulacion = deps(async () => aceptada(row.payload), noEmitir, async () => {
            correos += 1;
            return correos === 1 ? { codigo: 'CORREO_TRANSPORTE_INCIERTO' } : { referencia: 'demo-2' };
        });
        await fiscal.procesarLote({ facturacionId: row.factura.id }, simulacion);
        assert.equal((await estado(row.factura)).fiscal, 'ACEPTADO');
        assert.equal((await estado(row.factura)).correo_estado, 'PENDIENTE');
        await pool.query("UPDATE public.fg_facturacion_contingencia SET correo_proximo=now() WHERE facturacion_id=$1", [row.factura.id]);
        await fiscal.procesarLote({ facturacionId: row.factura.id }, simulacion);
        assert.equal((await estado(row.factura)).correo_estado, 'ENVIADO');
        assert.equal(correos, 2);
    });

    await t.test('una fecha vencida y una identidad remota distinta bloquean el POST', async () => {
        const atrasada = await armar();
        await pool.query('UPDATE public.fg_facturacion SET fecha_documento=fecha_documento-1 WHERE id=$1', [atrasada.factura.id]);
        await pool.query('UPDATE public.fg_facturacion_contingencia SET fecha_fiscal_original=fecha_fiscal_original-1 WHERE facturacion_id=$1', [atrasada.factura.id]);
        await fiscal.procesarLote({ facturacionId: atrasada.factura.id }, deps(async () => ausente, noEmitir));
        assert.equal((await estado(atrasada.factura)).ultimo_resultado, 'FECHA_FISCAL_REQUIERE_REVISION');
        const fuera = await armar();
        const otro = aceptada({ ...fuera.payload, numero: fuera.payload.numero + 1 });
        await fiscal.procesarLote({ facturacionId: fuera.factura.id }, deps(async () => otro, noEmitir));
        assert.equal((await estado(fuera.factura)).estado, 'REVISION');
        assert.equal((await estado(fuera.factura)).fiscal, 'PENDIENTE');
        const admin = await cont.listar(usuario, { estado: 'REVISION' });
        assert.equal(admin.items.find(item => String(item.facturacion_id) === String(atrasada.factura.id)).prioridad, true);
    });

    await t.test('un timeout en la consulta deja pendiente y un rechazo de datos termina en revisión', async () => {
        const fila = await armar();
        await fiscal.procesarLote({ facturacionId: fila.factura.id }, deps(async () => ({ status: 'ERROR', reason: 'TIMEOUT' }), noEmitir));
        assert.equal((await estado(fila.factura)).estado, 'PENDIENTE');
        const row = await armar();
        await fiscal.procesarLote({ facturacionId: row.factura.id }, deps(async () => ausente, async () => ({
            status: 'REJECTED', httpStatus: 400, data: { errors: 'Campos inválidos' }
        })));
        assert.equal((await estado(row.factura)).estado, 'REVISION');
        assert.equal((await estado(row.factura)).fiscal, 'RECHAZADO');
    });
});