const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Client } = require('pg');

// Configuración obligatoria para base aislada
process.env.APP_DATABASE_ENVIRONMENT = 'DEMO';
process.env.NODE_ENV = 'development';
process.env.DB_NAME = 'faregas_contingencia_lab';
process.env.FAREGAS_CONTINGENCIA_ENABLED = 'true';
process.env.FAREGAS_CONTINGENCIA_DB_NAME = 'faregas_contingencia_lab';
process.env.FAREGAS_CONTINGENCIA_TIPOS_DEMO = 'GLP_ANUAL:,GLP_INICIAL:,GNV_ANUAL:';
process.env.FAREGAS_CONTINGENCIA_OPERADORES_DEMO = 'operador_lab,gibarra,admin';
process.env.NUBEFACT_ENABLED = 'true';
process.env.NUBEFACT_ENVIRONMENT = 'DEMO';
process.env.NUBEFACT_ENVIAR_CLIENTE = 'false';
process.env.CRON_ENABLED = 'true';
process.env.FAREGAS_CONTINGENCIA_CORREO_URL = 'https://relay-demo.farenet.pe/api/v1/correo';
process.env.FAREGAS_CONTINGENCIA_CORREO_TOKEN = 'mock-token-lab';
process.env.FAREGAS_CONTINGENCIA_CORREO_IDEMPOTENTE = 'true';
process.env.FAREGAS_CONTINGENCIA_CORREO_DESTINO_DEMO = 'demo-lab@farenet.pe';
process.env.FAREGAS_CONTINGENCIA_CORREO_XML = 'true';

const pool = require('../../../config/database');
const config = require('../../../config/integrations.config');
const cont = require('../services/faregas-contingencia.service');
const fiscal = require('../services/faregas-contingencia-worker.service');
const auth = require('../services/faregas-auth.service');
const certs = require('../services/faregas-certificados.service');
const facturacionService = require('../services/faregas-facturacion.service');

test('SUITE DE INTEGRACIÓN — CONTINGENCIA NUBEFACT EN LABORATORIO AISLADO', async (t) => {
    t.after(async () => {
        await pool.end();
    });
    assert.equal(config.contingencia.habilitada, true, 'La contingencia debe estar habilitada en faregas_contingencia_lab');
    assert.equal(config.contingencia.baseAislada, 'faregas_contingencia_lab');

    const usuario = { username: 'operador_lab', perfil_id: 'SISTEMAS' };
    const sede = '98';
    const empresa = 'CAMBRIDGE';
    const ruc = '20600444531';
    const plazo = "(now() AT TIME ZONE 'America/Lima')::date";

    // Setup base aislada
    await pool.query("INSERT INTO public.fg_usuario (username, user_type, contrasenha, estado) VALUES ($1, 'USER', 'MOCK_PASS', true) ON CONFLICT (username) DO NOTHING", [usuario.username]);
    await pool.query("INSERT INTO public.moneda (key, descripcion) VALUES ('sol', 'Soles') ON CONFLICT DO NOTHING");
    await pool.query("INSERT INTO public.formapago (key, descripcion) VALUES ('contado', 'Contado') ON CONFLICT DO NOTHING");
    await pool.query("INSERT INTO public.fg_empresa (key, nombre, ruc, activo) VALUES ($1, 'I.T.V. CAMBRIDGE S.A.C.', $2, true) ON CONFLICT (key) DO UPDATE SET activo = true", [empresa, ruc]);
    await pool.query("INSERT INTO public.fg_planta (key, nombre, empresa_key, activo) VALUES ($1, 'SURCO LAB', $2, true) ON CONFLICT (key) DO UPDATE SET activo = true", [sede, empresa]);
    await pool.query("INSERT INTO public.fg_tipo_certificado (clave, nombre, codigo) VALUES ('GLP_ANUAL', 'GLP Anual Lab', '41') ON CONFLICT DO NOTHING");
    await pool.query("INSERT INTO public.fg_usuario_planta (usuario_username, plantas_key) VALUES ($1, $2) ON CONFLICT DO NOTHING", [usuario.username, sede]);
    await pool.query("INSERT INTO public.fg_perfil_planta (perfil_clave, planta_key) VALUES ($1, $2) ON CONFLICT DO NOTHING", [usuario.perfil_id, sede]);

    const ausente = { httpStatus: 400, status: 'REJECTED', data: { errors: 'Documento no existe', codigo: 24 } };
    const aceptada = (doc) => ({
        httpStatus: 200, status: 'ACCEPTED', data: {
            serie: doc.serie, numero: doc.numero, tipo_de_comprobante: doc.tipo_de_comprobante,
            ruc_emisor: ruc, enlace_del_pdf: 'https://nubefact.com/pdf/test-lab.pdf',
            enlace_del_xml: 'https://nubefact.com/xml/test-lab.xml', enlace_del_cdr: 'https://nubefact.com/cdr/test-lab.cdr',
            codigo_hash: 'HASH12345678LAB', sunat_responsecode: '0', sunat_description: 'Aceptado por SUNAT en laboratorio'
        }
    });

    const deps = (consultarComprobante, emitirComprobante, enviar = async () => ({ referencia: 'REF-CORREO-LAB-001' })) => ({
        proveedor: { consultarComprobante, emitirComprobante },
        emisor: { resolverParaPlanta: async () => ({ environment: 'DEMO', empresaKey: empresa, rucEmisor: ruc, credentials: {} }) },
        correo: { enviar }
    });

    const armar = async ({ emitido = true, email = null, cola = true, falloTemporal = true } = {}) => {
        const seq = Number((await pool.query("SELECT nextval(pg_get_serial_sequence('public.fg_facturacion','id')) AS id")).rows[0].id);
        const numero = seq + 10000;
        const cert = (await pool.query(
            "INSERT INTO public.fg_certificado (tipo_certificado_clave, planta_key, usuario_creacion, estado, numero_certificado) " +
            "VALUES ('GLP_ANUAL', $1, $2, $3, $4) RETURNING id",
            [sede, usuario.username, emitido ? 'EMITIDO' : 'BORRADOR', 'LAB-CERT-' + numero]
        )).rows[0];

        const operacion = (await pool.query(
            "INSERT INTO public.fg_operacion_comercial (planta_key, usuario_creacion, estado, importe_total) " +
            "VALUES ($1, $2, 'PAGADO', 100) RETURNING id",
            [sede, usuario.username]
        )).rows[0].id;

        const orden = (await pool.query(
            "INSERT INTO public.fg_orden_pago (certificado_id, operacion_id, importe_total, baseimponible, igv, " +
            "importe_pagado, saldo_pendiente, estado, usuariocreacion_username) VALUES ($1, $2, 100, 84.75, 15.25, 100, 0, 'PAGADO', $3) RETURNING *",
            [cert.id, operacion, usuario.username]
        )).rows[0];

        const factura = (await pool.query(
            "INSERT INTO public.fg_facturacion (certificado_id, operacion_id, tipo_comprobante, tipo_documento_cliente, nro_documento, " +
            "nombre_razon_social, direccion, base_imponible, igv, importe_total, usuario_creacion, planta_key, empresa_key, ruc_emisor, " +
            "email, serie, numero, nro_comprobante, codigo_unico, fecha_documento, estado, entorno_facturador, intentos) " +
            "VALUES ($1, $2, 'FACTURA', 'RUC', '20600444531', 'CLIENTE PRUEBA LAB', 'AV. LAB 123', 84.75, 15.25, 100, $3, $4, $5, $6, " +
            "$7, 'FFF1', $8, $9, $10, " + plazo + ", $11, 'DEMO', 1) RETURNING *",
            [cert.id, operacion, usuario.username, sede, empresa, ruc, email, numero, 'FFF1-' + numero, 'FG-' + seq, cola ? 'PENDIENTE' : 'ERROR']
        )).rows[0];

        const payload = { operacion: 'generar_comprobante', serie: 'FFF1', numero, tipo_de_comprobante: 1, codigo_unico: factura.codigo_unico };
        const diag = falloTemporal
            ? { categoria: 'TIMEOUT', recuperable: true, ausenciaConfirmada: true, seguimiento: 'LAB-INTENTO-1' }
            : { categoria: 'RECHAZO_FISCAL', recuperable: false, ausenciaConfirmada: false, seguimiento: 'LAB-RECHAZO-FISCAL' };

        const intentoId = (await pool.query(
            "INSERT INTO public.fg_facturacion_intento (facturacion_id, numero_intento, estado, solicitud, respuesta) VALUES " +
            "($1, 1, 'ERROR', $2::jsonb, $3::jsonb) RETURNING id",
            [factura.id, JSON.stringify(payload), JSON.stringify({ _faregas_contingencia: diag })]
        )).rows[0].id;

        if (cola) {
            await pool.query(
                "INSERT INTO public.fg_facturacion_contingencia (facturacion_id, certificado_id, operacion_id, intento_origen_id, " +
                "planta_key, empresa_key, usuario_autorizacion, fecha_fiscal_original, diagnostico) VALUES ($1, $2, $3, $4, $5, $6, $7, " + plazo + ", $8::jsonb)",
                [factura.id, cert.id, operacion, intentoId, sede, empresa, usuario.username, JSON.stringify(diag)]
            );
        }

        return { factura, cert, payload, orden, operacion, intentoId };
    };

    const estadoFactura = async (id) => (
        await pool.query("SELECT j.*, f.estado AS fiscal, f.aceptada_sunat FROM public.fg_facturacion_contingencia j JOIN public.fg_facturacion f ON f.id = j.facturacion_id WHERE j.facturacion_id = $1", [id])
    ).rows[0];

    // TEST 1: Caída de NubeFact y visualización de diagnóstico
    await t.test('1-4. Diagnóstico de falla de NubeFact y habilitación de EMITIR SOLO CERTIFICADO', async () => {
        const row = await armar({ emitido: false, cola: false });
        t.mock.method(auth, 'validarAccesoPlanta', async () => ({ key: sede }));
        t.mock.method(auth, 'getPlantasPorUsuario', async () => [{ key: sede }]);
        t.mock.method(certs, 'validarEmision', async () => ({ valido: true }));

        const ctx = await cont.obtenerContexto(row.cert.id, usuario);
        assert.equal(ctx.habilitada, true);
        assert.equal(ctx.permiteSoloCertificado, true, 'Debe permitir emitir solo certificado');
        assert.equal(ctx.diagnostico.categoria, 'TIMEOUT');
    });

    // TEST 2: Emisión solo del certificado (puntos 5, 6, 7, 8, 9)
    await t.test('5-9. Emisión de solo certificado: asigna número, conserva pagos y deja comprobante pendiente', async () => {
        const row = await armar({ emitido: false, cola: false });
        t.mock.method(auth, 'validarAccesoPlanta', async () => ({ key: sede }));
        t.mock.method(auth, 'getPlantasPorUsuario', async () => [{ key: sede }]);
        t.mock.method(certs, 'validarEmision', async () => ({ valido: true }));

        const emitido = await certs.emitirCertificado(row.cert.id, usuario, { contingencia: true });
        assert.ok(emitido.numero_certificado, 'Debe asignar correlativo definitivo');
        assert.equal(emitido.estadoRegularizacion, 'PENDIENTE');

        const est = await estadoFactura(row.factura.id);
        assert.equal(est.fiscal, 'PENDIENTE', 'El comprobante queda pendiente de regularización');
        assert.equal(est.estado, 'PENDIENTE', 'El trabajo de contingencia queda pendiente');

        // Conservación de pagos: saldo 0, importe 100
        const pago = (await pool.query('SELECT * FROM fg_orden_pago WHERE id = $1', [row.orden.id])).rows[0];
        assert.equal(Number(pago.saldo_pendiente), 0);
        assert.equal(Number(pago.importe_pagado), 100);

        // Previene duplicados de emisión de certificado
        const reemision = await certs.emitirCertificado(row.cert.id, usuario, { contingencia: true });
        assert.equal(reemision.recuperado, true, 'No debe reemitir otro certificado');
    });

    // TEST 3: Regularización automática y envío de correo (puntos 10, 11)
    await t.test('10-11. Regularización automática: NubeFact acepta y envía correo al cliente', async () => {
        const row = await armar({ email: 'demo-lab@farenet.pe' });
        const eventos = [];
        const sim = deps(
            async () => { eventos.push('consultar'); return ausente; },
            async (p) => { eventos.push('emitir'); return aceptada(p); },
            async (job) => { eventos.push('correo'); return { referencia: 'CORREO-LAB-OK-999' }; }
        );

        const res = await fiscal.procesarLote({ facturacionId: row.factura.id }, sim);
        assert.equal(res.reclamados, 1);
        assert.deepEqual(eventos, ['consultar', 'emitir', 'correo']);

        const final = await estadoFactura(row.factura.id);
        assert.equal(final.fiscal, 'ACEPTADO');
        assert.equal(final.aceptada_sunat, true);
        assert.equal(final.estado, 'REGULARIZADO');
        assert.equal(final.correo_estado, 'ENVIADO');
        assert.equal(final.correo_referencia, 'CORREO-LAB-OK-999');
    });

    // TEST 4: Operación sin correo (punto 12)
    await t.test('12. Operación sin correo del cliente: marca SIN_CORREO sin bloquear', async () => {
        const row = await armar({ email: null });
        const sim = deps(
            async () => ausente,
            async (p) => aceptada(p)
        );

        await fiscal.procesarLote({ facturacionId: row.factura.id }, sim);
        const final = await estadoFactura(row.factura.id);
        assert.equal(final.fiscal, 'ACEPTADO');
        assert.equal(final.estado, 'REGULARIZADO');
        assert.equal(final.correo_estado, 'SIN_CORREO');
        assert.equal(final.correo_intentos, 0);
    });

    // TEST 5: Falla temporal de correo (punto 13)
    await t.test('13. Error en relay de correo: reintenta el correo sin reemitir comprobante', async () => {
        const row = await armar({ email: 'demo-lab@farenet.pe' });
        let intentosCorreo = 0;
        const sim = deps(
            async () => aceptada(row.payload),
            async () => { throw Error('No debe reenviar comprobante'); },
            async () => {
                intentosCorreo += 1;
                return intentosCorreo === 1 ? { codigo: 'CORREO_TEMPORAL_503' } : { referencia: 'CORREO-REINTENTO-EXITOSO' };
            }
        );

        // Intento 1: falla correo
        await fiscal.procesarLote({ facturacionId: row.factura.id }, sim);
        let est = await estadoFactura(row.factura.id);
        assert.equal(est.fiscal, 'ACEPTADO');
        assert.equal(est.correo_estado, 'PENDIENTE', 'Correo queda pendiente');

        // Intento 2: recupera correo
        await pool.query("UPDATE fg_facturacion_contingencia SET correo_proximo = now() WHERE facturacion_id = $1", [row.factura.id]);
        await fiscal.procesarLote({ facturacionId: row.factura.id }, sim);
        est = await estadoFactura(row.factura.id);
        assert.equal(est.correo_estado, 'ENVIADO');
        assert.equal(est.correo_referencia, 'CORREO-REINTENTO-EXITOSO');
        assert.equal(intentosCorreo, 2);
    });

    // TEST 6: Prevención de duplicados concurrentes (punto 14)
    await t.test('14. Prevención de concurrencia: dos trabajadores simultáneos no duplican comprobante', async () => {
        const row = await armar({ email: 'demo-lab@farenet.pe' });
        let conteoEmision = 0;
        const sim = deps(
            async () => ausente,
            async (p) => { conteoEmision += 1; return aceptada(p); },
            async () => ({ referencia: 'OK' })
        );

        const [t1, t2] = await Promise.all([
            fiscal.procesarLote({ facturacionId: row.factura.id }, sim),
            fiscal.procesarLote({ facturacionId: row.factura.id }, sim)
        ]);

        assert.equal(t1.reclamados + t2.reclamados, 1, 'Solo un trabajador reclama el bloqueo');
        assert.equal(conteoEmision, 1, 'Solo se emite un comprobante');
    });

    // TEST 7: Reinicio del backend con trabajos pendientes (punto 15)
    await t.test('15. Reinicio del backend: recupera trabajos con lease vencido', async () => {
        const row = await armar();
        // Simular que el proceso anterior murió y dejó lease vencido
        await pool.query("UPDATE fg_facturacion_contingencia SET lease_token = $2, lease_hasta = now() - interval '1 minute' WHERE facturacion_id = $1",
            [row.factura.id, randomUUID()]);

        const sim = deps(
            async () => aceptada(row.payload),
            async () => { throw Error('No debe emitir'); }
        );

        const res = await fiscal.procesarLote({ facturacionId: row.factura.id }, sim);
        assert.equal(res.reclamados, 1);
        const est = await estadoFactura(row.factura.id);
        assert.equal(est.estado, 'REGULARIZADO');
        assert.equal(est.lease_token, null, 'Libera el lease');
    });

    // TEST 8: Rechazo fiscal definitivo (punto 16)
    await t.test('16. Rechazo fiscal definitivo: pasa a REVISION y bloquea reintentos indebidos', async () => {
        const row = await armar({ falloTemporal: false });
        const sim = deps(
            async () => ausente,
            async () => ({
                status: 'REJECTED',
                httpStatus: 400,
                data: { sunat_responsecode: '2014', sunat_description: 'El RUC del receptor no existe en SUNAT' }
            })
        );

        await fiscal.procesarLote({ facturacionId: row.factura.id }, sim);
        const est = await estadoFactura(row.factura.id);
        assert.equal(est.estado, 'REVISION', 'Pasa a REVISIÓN administrativa');
        assert.equal(est.fiscal, 'RECHAZADO');
    });
});
