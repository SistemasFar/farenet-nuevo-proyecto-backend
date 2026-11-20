const { randomUUID } = require('node:crypto');
const db = require('../../../config/database');
const config = require('../../../config/integrations.config');
const proveedor = require('../../../services/integrations/nubefact.service');
const emisor = require('./faregas-nubefact-config.service');
const correo = require('../integrations/faregas-contingencia-correo.adapter');
const { coincideIdentidad } = require('./faregas-contingencia.service');
const { clasificarResultado, ausenciaConfirmada, coincideRespuestaFiscal } = require('./faregas-contingencia-errores');
const {
    mapearEstadoProveedor, mapearAceptacionSunat, limpiarRespuestaProveedor
} = require('../integrations/nubefact-faregas.adapter');

const RETRASO_HORAS = 1;
const MAX_INTENTOS = 5;
const LOTE = 10;
const ADVISORY_NAMESPACE = 784301;

const cargarTrabajo = async (client, id, token, bloquear = false) => {
    const { rows } = await client.query(
        "SELECT j.*, j.fecha_fiscal_original::text AS fecha_fiscal_original, c.numero_certificado, c.estado AS estado_certificado, f.estado AS estado_fiscal, " +
        "f.aceptada_sunat, f.serie, f.numero, f.codigo_unico, f.nro_comprobante, f.tipo_comprobante, " +
        "f.entorno_facturador, f.ruc_emisor, f.email, f.nombre_razon_social, f.enlace_pdf, f.enlace_xml, f.enlace_cdr, " +
        "f.fecha_documento = j.fecha_fiscal_original AS fecha_conservada, " +
        "(f.fecha_ultimo_intento > now() - ($3::integer * interval '1 millisecond')) IS TRUE AS espera_post, " +
        "j.fecha_fiscal_original = (now() AT TIME ZONE 'America/Lima')::date AS fecha_vigente, " +
        "i.solicitud AS payload, " +
        "(EXISTS (SELECT 1 FROM public.fg_documento_anulacion a WHERE a.facturacion_id=f.id " +
        "AND a.estado IN ('BORRADOR','PENDIENTE','ACEPTADO')) OR " +
        "EXISTS (SELECT 1 FROM public.fg_solicitud_operacion s WHERE s.certificado_id=c.id " +
        "AND s.estado IN ('PENDIENTE_APROBACION','APROBADA','EN_EJECUCION','REQUIERE_INTERVENCION'))) AS bloqueada " +
        "FROM public.fg_facturacion_contingencia j JOIN public.fg_certificado c ON c.id=j.certificado_id " +
        "JOIN public.fg_facturacion f ON f.id=j.facturacion_id AND f.certificado_id=c.id " +
        "JOIN public.fg_facturacion_intento i ON i.id=j.intento_origen_id AND i.facturacion_id=f.id " +
        "WHERE j.facturacion_id=$1 AND j.lease_token=$2 " + (bloquear ? "FOR UPDATE OF c, f, j" : ""),
        [id, token, Math.max(120000, config.nubefact.retryLockMs)]
    );
    return rows[0];
};

const reclamar = async (pool, id, base) => {
    const token = randomUUID();
    const result = await pool.query(
        "WITH candidato AS (SELECT j.facturacion_id FROM public.fg_facturacion_contingencia j " +
        "WHERE current_database()=$3 AND ($2::bigint IS NULL OR j.facturacion_id=$2) " +
        "AND (j.lease_hasta IS NULL OR j.lease_hasta <= now()) AND " +
        "((j.estado='PENDIENTE' AND j.siguiente_intento <= now()) OR " +
        "(j.estado='REGULARIZADO' AND j.correo_estado='PENDIENTE' AND j.correo_proximo <= now())) " +
        "ORDER BY CASE WHEN j.estado='PENDIENTE' THEN j.siguiente_intento ELSE j.correo_proximo END, j.facturacion_id " +
        "LIMIT 1 FOR UPDATE SKIP LOCKED) UPDATE public.fg_facturacion_contingencia j SET " +
        "lease_token=$1, lease_hasta=now()+interval '10 minutes' FROM candidato c " +
        "WHERE j.facturacion_id=c.facturacion_id RETURNING j.facturacion_id",
        [token, id, base]
    );
    return result.rows[0] && { id: result.rows[0].facturacion_id, token };
};

const marcarFiscal = (client, job, estado, resultado) => client.query(
    "UPDATE public.fg_facturacion_contingencia j SET estado=$3::varchar, ultimo_resultado=$4, " +
    "siguiente_intento=now()+($5 * interval '1 hour'), " +
    "fecha_regularizacion=CASE WHEN $3='REGULARIZADO' THEN COALESCE(fecha_regularizacion,now()) ELSE fecha_regularizacion END, " +
    "correo_estado=CASE WHEN $3='REGULARIZADO' AND correo_estado='EN_ESPERA' THEN $6 ELSE correo_estado END, " +
    "correo_proximo=CASE WHEN $3='REGULARIZADO' THEN now() ELSE correo_proximo END " +
    "WHERE facturacion_id=$1 AND lease_token=$2",
    [job.facturacion_id, job.lease_token, estado, resultado, RETRASO_HORAS,
        correo.correoValido(job.email) ? 'PENDIENTE' : 'SIN_CORREO']
);

const bloquearMotivo = (job) => {
    if (job.estado_certificado === 'ANULADO' || job.estado_fiscal === 'ANULADO') return 'DOCUMENTO_ANULADO';
    if (job.estado_certificado !== 'EMITIDO' || job.bloqueada) return 'OPERACION_BLOQUEADA';
    if (job.entorno_facturador !== 'DEMO' || !job.fecha_conservada || !coincideIdentidad(job, job.payload)) {
        return 'IDENTIDAD_FISCAL_NO_VERIFICABLE';
    }
    return null;
};

// Solo metadatos de diagnóstico se exponen en administración. El registro fiscal
// conserva la respuesta depurada por el adaptador existente.
const iniciarIntento = async (client, job, payload) => {
    const r = await client.query(
        "INSERT INTO public.fg_facturacion_intento (facturacion_id, numero_intento, estado, solicitud) " +
        "SELECT $1, COALESCE(MAX(numero_intento),0)+1, 'PENDIENTE', $2::jsonb " +
        "FROM public.fg_facturacion_intento WHERE facturacion_id=$1 RETURNING id",
        [job.facturacion_id, JSON.stringify(payload)]
    );
    return r.rows[0].id;
};

const cerrarIntento = (client, id, respuesta, estado) => client.query(
    "UPDATE public.fg_facturacion_intento SET estado=$2, respuesta=$3::jsonb, http_status=$4, error=$5, " +
    "fecha_finalizacion=now() WHERE id=$1",
    [id, estado, JSON.stringify(limpiarRespuestaProveedor(respuesta?.data)), respuesta?.httpStatus || null,
        estado === 'ACEPTADO' || estado === 'PENDIENTE_SUNAT' ? null : clasificarResultado(respuesta).categoria]
);

const aplicarRespuesta = async (client, job, respuesta) => {
    const estado = mapearEstadoProveedor(respuesta);
    const aceptada = mapearAceptacionSunat(respuesta);
    const data = respuesta.data || {};
    const texto = (value) => typeof value === 'string' ? value : null;
    await client.query(
        "UPDATE public.fg_facturacion SET estado=$2, aceptada_sunat=$3, " +
        "sunat_description=$4, sunat_responsecode=$5, sunat_soap_error=$6, " +
        "enlace_pdf=COALESCE($7,enlace_pdf), enlace_xml=COALESCE($8,enlace_xml), " +
        "enlace_cdr=COALESCE($9,enlace_cdr), cadena_qr=COALESCE($10,cadena_qr), codigo_hash=COALESCE($11,codigo_hash), " +
        "respuesta_proveedor=$12::jsonb, fecha_ultimo_intento=now(), " +
        "fecha_aceptacion=CASE WHEN $3 THEN COALESCE(fecha_aceptacion,now()) ELSE fecha_aceptacion END, " +
        "usuario_modificacion=$13, fecha_modificacion=now() WHERE id=$1 AND estado NOT IN ('ACEPTADO','ANULADO')",
        [job.facturacion_id, estado, aceptada, texto(data.sunat_description), texto(String(data.sunat_responsecode ?? '')) || null,
            texto(data.sunat_soap_error), data.enlace_del_pdf || data.enlace_pdf || data.enlace || null,
            data.enlace_del_xml || data.enlace_xml || null, data.enlace_del_cdr || data.enlace_cdr || null,
            data.cadena_para_codigo_qr || null, data.codigo_hash || null,
            JSON.stringify(limpiarRespuestaProveedor(data)), job.usuario_autorizacion]
    );
    if (aceptada && job.operacion_id) {
        await client.query(
            "UPDATE public.fg_operacion_comercial SET estado='FACTURADO', usuario_modificacion=$2, fecha_modificacion=now() " +
            "WHERE id=$1 AND estado IN ('PAGADO','FACTURADO')",
            [job.operacion_id, job.usuario_autorizacion]
        );
    }
    return estado;
};

const registrarRespuesta = async (client, job, resultado) => {
    const estado = await aplicarRespuesta(client, job, resultado);
    const siguiente = estado === 'ACEPTADO' ? 'REGULARIZADO' : estado === 'PENDIENTE_SUNAT' ? 'PENDIENTE' : 'REVISION';
    await marcarFiscal(client, job, siguiente, estado);
    return estado;
};

const transaccion = async (client, ejecutar) => {
    await client.query('BEGIN');
    try {
        const value = await ejecutar();
        await client.query('COMMIT');
        return value;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    }
};

const puedeReenviar = (job) => job.fecha_vigente && ['PENDIENTE', 'ERROR'].includes(job.estado_fiscal)
    && job.aceptada_sunat !== true && !job.enlace_pdf && !job.enlace_xml && !job.enlace_cdr;

const procesarFiscal = async (client, job, deps) => {
    const bloqueada = bloquearMotivo(job);
    if (bloqueada) {
        await marcarFiscal(client, job, bloqueada === 'DOCUMENTO_ANULADO' ? 'CANCELADO' : 'REVISION', bloqueada);
        return;
    }
    if (job.estado_fiscal === 'ACEPTADO' && job.aceptada_sunat === true) {
        await marcarFiscal(client, job, 'REGULARIZADO', 'ACEPTADO');
        return;
    }
    if (job.estado_fiscal === 'RECHAZADO' || (job.intentos >= MAX_INTENTOS && job.ultimo_resultado !== 'LIMITE_DEMO_AGOTADO')) {
        await marcarFiscal(client, job, 'REVISION', job.estado_fiscal === 'RECHAZADO' ? 'RECHAZO_FISCAL' : 'MAX_INTENTOS');
        return;
    }

    let credenciales;
    try {
        credenciales = await deps.emisor.resolverParaPlanta(job.planta_key, client);
    } catch {
        await marcarFiscal(client, job, 'REVISION', 'ERROR_CONFIGURACION');
        return;
    }
    if (credenciales.environment !== 'DEMO' || String(credenciales.rucEmisor) !== String(job.ruc_emisor)
        || credenciales.empresaKey !== job.empresa_key) {
        await marcarFiscal(client, job, 'REVISION', 'EMISOR_NO_COINCIDE');
        return;
    }

    const parametros = {
        tipoDeComprobante: job.payload.tipo_de_comprobante,
        serie: job.serie,
        numero: job.numero
    };
    const consultaId = await transaccion(client, async () => {
        const vigente = await cargarTrabajo(client, job.facturacion_id, job.lease_token, true);
        if (!vigente || bloquearMotivo(vigente)) return null;
        const id = await iniciarIntento(client, vigente, { operacion: 'consultar_comprobante', ...parametros, origen: 'CONTINGENCIA' });
        await client.query(
            "UPDATE public.fg_facturacion_contingencia SET intentos=intentos+1, ultimo_intento=now() WHERE facturacion_id=$1 AND lease_token=$2",
            [job.facturacion_id, job.lease_token]
        );
        return id;
    });
    if (!consultaId) return;
    const consulta = await deps.proveedor.consultarComprobante(parametros, { credentials: credenciales.credentials });
    if (['ACCEPTED', 'PENDING_SUNAT', 'REJECTED'].includes(consulta?.status) && coincideRespuestaFiscal(job, consulta)) {
        await transaccion(client, async () => {
            const vigente = await cargarTrabajo(client, job.facturacion_id, job.lease_token, true);
            const estado = vigente && !bloquearMotivo(vigente)
                ? await registrarRespuesta(client, vigente, consulta) : 'ERROR';
            await cerrarIntento(client, consultaId, consulta, estado);
        });
        return;
    }

    const ausente = ausenciaConfirmada(consulta);
    await cerrarIntento(client, consultaId, consulta, 'ERROR');
    if (!ausente) {
        const diagnostico = clasificarResultado(consulta);
        const revisar = ['ACCEPTED','PENDING_SUNAT'].includes(consulta?.status) || !diagnostico.recuperable || !job.fecha_vigente;
        await marcarFiscal(client, job, revisar ? 'REVISION' : 'PENDIENTE',
            !job.fecha_vigente ? 'FECHA_FISCAL_REQUIERE_REVISION' : revisar ? 'RESULTADO_REMOTO_NO_VERIFICABLE' : diagnostico.categoria);
        return;
    }

    // Se escribe el intento antes del POST. Si se pierde la respuesta o se
    // reinicia el proceso, el siguiente ciclo vuelve a consultar remotamente.
    const payload = { ...job.payload, enviar_automaticamente_al_cliente: false };
    const emisionId = await transaccion(client, async () => {
        const vigente = await cargarTrabajo(client, job.facturacion_id, job.lease_token, true);
        if (!vigente || bloquearMotivo(vigente)) return null;
        if (vigente.espera_post && puedeReenviar(vigente)) {
            await marcarFiscal(client, vigente, 'PENDIENTE', 'ESPERA_CONFIRMACION_PROVEEDOR');
            return null;
        }
        if (!puedeReenviar(vigente)) {
            if (vigente.estado_fiscal === 'ACEPTADO' && vigente.aceptada_sunat) {
                await marcarFiscal(client, vigente, 'REGULARIZADO', 'ACEPTADO');
            } else {
                await marcarFiscal(client, vigente, 'REVISION', vigente.fecha_vigente
                    ? 'ESTADO_FISCAL_REQUIERE_REVISION' : 'FECHA_FISCAL_REQUIERE_REVISION');
            }
            return null;
        }
        await client.query("UPDATE public.fg_facturacion SET intentos=intentos+1, fecha_ultimo_intento=now() WHERE id=$1",
            [job.facturacion_id]);
        return iniciarIntento(client, vigente, payload);
    });
    if (!emisionId) return;

    await transaccion(client, async () => {
        const vigente = await cargarTrabajo(client, job.facturacion_id, job.lease_token, true);
        if (!vigente || bloquearMotivo(vigente) || !puedeReenviar(vigente)) {
            await cerrarIntento(client, emisionId, null, 'ERROR');
            return;
        }
        const resultado = await deps.proveedor.emitirComprobante(payload, { credentials: credenciales.credentials });
        let estadoIntento = 'ERROR';
        const diagnostico = clasificarResultado(resultado);
        const coincide = coincideRespuestaFiscal(vigente, resultado);
        if (['ACCEPTED', 'PENDING_SUNAT'].includes(resultado?.status) && coincide) {
            estadoIntento = await registrarRespuesta(client, vigente, resultado);
        } else if (diagnostico.categoria === 'LIMITE_DEMO_AGOTADO') {
            await marcarFiscal(client, vigente, 'PENDIENTE', diagnostico.categoria);
        } else if (['VALIDACION_RECHAZADA', 'RECHAZO_FISCAL'].includes(diagnostico.categoria)) {
            const rechazo = { ...resultado, status: 'REJECTED', data: coincide ? resultado.data : {
                sunat_responsecode: resultado.data?.sunat_responsecode,
                sunat_description: diagnostico.mensajeOriginalNormalizado || diagnostico.descripcion
            } };
            estadoIntento = await registrarRespuesta(client, vigente, rechazo);
        } else {
            await marcarFiscal(client, vigente, diagnostico.recuperable ? 'PENDIENTE' : 'REVISION',
                ['ACCEPTED', 'PENDING_SUNAT'].includes(resultado?.status) ? 'IDENTIDAD_REMOTA_NO_VERIFICABLE' : diagnostico.categoria);
        }
        await cerrarIntento(client, emisionId, resultado, estadoIntento);
    });
};

const procesarCorreo = async (client, job, deps) => {
    if (bloquearMotivo(job) || job.estado_fiscal !== 'ACEPTADO' || job.aceptada_sunat !== true) {
        await client.query("UPDATE public.fg_facturacion_contingencia SET correo_estado='REVISION', correo_ultimo_error='DOCUMENTO_NO_ENTREGABLE' WHERE facturacion_id=$1 AND lease_token=$2", [job.facturacion_id, job.lease_token]);
        return;
    }
    const tieneCorreo = correo.correoValido(job.email);
    const resultado = tieneCorreo ? await deps.correo.enviar(job, { config: deps.config }) : {};
    const sinDestinatario = !tieneCorreo || resultado.sinCorreo;
    const estado = sinDestinatario ? 'SIN_CORREO' : resultado.referencia ? 'ENVIADO'
        : resultado.revision || job.correo_intentos + 1 >= MAX_INTENTOS ? 'REVISION' : 'PENDIENTE';
    await client.query(
        "UPDATE public.fg_facturacion_contingencia SET correo_estado=$3::varchar, correo_ultimo_error=$4, " +
        "correo_referencia=$5, correo_intentos=correo_intentos+$6, correo_proximo=now()+interval '1 hour', " +
        "correo_fecha_envio=CASE WHEN $3='ENVIADO' THEN now() ELSE correo_fecha_envio END " +
        "WHERE facturacion_id=$1 AND lease_token=$2",
        [job.facturacion_id, job.lease_token, estado, resultado.codigo || null, resultado.referencia || null, sinDestinatario ? 0 : 1]
    );
};

const procesarLote = async (options = {}, dependencies = {}) => {
    const ajustes = dependencies.config || config.contingencia;
    if (!ajustes.habilitada) return { reclamados: 0, errores: 0 };
    const pool = dependencies.db || db;
    const deps = { proveedor, emisor, correo, ...dependencies, config: ajustes };
    const resumen = { reclamados: 0, errores: 0 };
    const id = options.facturacionId || null;
    for (let i = 0; i < (id ? 1 : LOTE); i += 1) {
        const claim = await reclamar(pool, id, ajustes.baseAislada);
        if (!claim) break;
        resumen.reclamados += 1;
        const client = await pool.connect();
        try {
            const { rows } = await client.query(
                'SELECT pg_try_advisory_lock($1::integer, hashtext($2::text)) AS adquirida',
                [ADVISORY_NAMESPACE, claim.id]
            );
            if (!rows[0].adquirida) {
                await client.query("UPDATE public.fg_facturacion_contingencia SET siguiente_intento=now()+interval '5 minutes', correo_proximo=now()+interval '5 minutes' WHERE facturacion_id=$1 AND lease_token=$2", [claim.id, claim.token]);
                continue;
            }
            let job = await cargarTrabajo(client, claim.id, claim.token);
            if (job?.estado === 'PENDIENTE') {
                await procesarFiscal(client, job, deps);
                job = await cargarTrabajo(client, claim.id, claim.token);
            }
            if (job?.estado === 'REGULARIZADO' && job.correo_estado === 'PENDIENTE') {
                await transaccion(client, async () => {
                    const vigente = await cargarTrabajo(client, claim.id, claim.token, true);
                    if (vigente?.estado === 'REGULARIZADO' && vigente.correo_estado === 'PENDIENTE') {
                        await procesarCorreo(client, vigente, deps);
                    }
                });
            }
        } catch {
            resumen.errores += 1;
            await client.query(
                "UPDATE public.fg_facturacion_contingencia SET siguiente_intento=now()+interval '1 hour', " +
                "correo_proximo=now()+interval '1 hour', ultimo_resultado='ERROR_INTERNO_FAREGAS', " +
                "estado=CASE WHEN estado='PENDIENTE' THEN 'REVISION' ELSE estado END WHERE facturacion_id=$1 AND lease_token=$2",
                [claim.id, claim.token]
            ).catch(() => {});
        } finally {
            let descartarCliente = false;
            try {
                await client.query('SELECT pg_advisory_unlock($1::integer, hashtext($2::text))', [ADVISORY_NAMESPACE, claim.id]);
                await client.query("UPDATE public.fg_facturacion_contingencia SET lease_token=NULL,lease_hasta=NULL WHERE facturacion_id=$1 AND lease_token=$2", [claim.id, claim.token]);
            } catch { descartarCliente = true; }
            client.release(descartarCliente);
        }
    }
    return resumen;
};

module.exports = { procesarLote };
