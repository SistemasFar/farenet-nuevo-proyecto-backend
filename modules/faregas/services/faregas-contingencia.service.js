const db = require('../../../config/database');
const config = require('../../../config/integrations.config');
const auth = require('./faregas-auth.service');
const { ausenciaConfirmada, clasificarResultado, identificarLimiteDemo } = require('./faregas-contingencia-errores');

const error = (code, statusCode = 409) => Object.assign(new Error(code), { code, statusCode });

const cargar = async (certificadoId, executor = db, bloquear = false) => {
    const { rows } = await executor.query(
        "SELECT c.id AS certificado_id, c.estado AS certificado_estado, c.numero_certificado, c.planta_key AS certificado_planta_key, " +
        "c.tipo_certificado_clave, COALESCE(s.modalidad, '') AS modalidad, " +
        "f.*, f.fecha_documento::text AS fecha_original, f.fecha_documento = (now() AT TIME ZONE 'America/Lima')::date AS fecha_original_vigente, " +
        "i.id AS intento_id, i.respuesta AS respuesta_intento, i.solicitud AS solicitud_origen, COALESCE(j.diagnostico,i.respuesta->'_faregas_contingencia') AS diagnostico, " +
        "j.estado AS estado_trabajo, " +
        "(EXISTS (SELECT 1 FROM public.fg_documento_anulacion a WHERE a.facturacion_id = f.id " +
        "AND a.estado IN ('BORRADOR', 'PENDIENTE', 'ACEPTADO')) OR EXISTS (SELECT 1 FROM public.fg_solicitud_operacion r " +
        "WHERE r.certificado_id = c.id AND r.estado IN ('PENDIENTE_APROBACION','APROBADA','EN_EJECUCION','REQUIERE_INTERVENCION'))) AS tiene_bloqueo " +
        "FROM public.fg_certificado c JOIN public.fg_facturacion f ON f.certificado_id = c.id " +
        "LEFT JOIN public.fg_tarifa t ON t.codigo = c.tarifa_codigo AND t.planta_key = c.planta_key " +
        "LEFT JOIN public.fg_servicio s ON s.id = t.servicio_id " +
        "LEFT JOIN public.fg_facturacion_contingencia j ON j.facturacion_id = f.id " +
        "LEFT JOIN LATERAL (SELECT id, solicitud, respuesta FROM public.fg_facturacion_intento " +
        "WHERE facturacion_id = f.id ORDER BY id DESC LIMIT 1) i ON true " +
        "WHERE c.id = $1 AND current_database() = $2 " + (bloquear ? "FOR UPDATE OF f" : ""),
        [certificadoId, config.contingencia.baseAislada]
    );
    const row = rows[0];
    if (row) row.diagnostico = diagnosticoGuardado(row);
    return row || null;
};

const coincideIdentidad = (doc, payload) => Boolean(
    payload && payload.operacion === 'generar_comprobante'
    && String(payload.serie) === String(doc.serie)
    && Number.isSafeInteger(Number(doc.numero)) && Number(doc.numero) > 0
    && String(payload.numero) === String(doc.numero)
    && ['FACTURA', 'BOLETA'].includes(doc.tipo_comprobante)
    && Number(payload.tipo_de_comprobante) === (doc.tipo_comprobante === 'FACTURA' ? 1 : 2)
    && doc.codigo_unico && payload.codigo_unico === doc.codigo_unico
);

const evaluar = (row, opciones = config.contingencia) => {
    if (!row || !opciones.habilitada) return 'CONTINGENCIA_NO_HABILITADA';
    const tipo = (row.tipo_certificado_clave + ':' + String(row.modalidad || '')).toUpperCase().trim();
    if (!Array.isArray(opciones.tiposDemo) || opciones.tiposDemo.includes('*')) {
        return 'TIPO_SIN_AUTORIZACION_DEMO';
    }
    const tipoPermitido = opciones.tiposDemo.some(t => String(t || '').toUpperCase().trim() === tipo);
    if (!tipoPermitido) return 'TIPO_SIN_AUTORIZACION_DEMO';
    const cuotaDemo = row.diagnostico?.categoria === 'LIMITE_DEMO_AGOTADO';
    if (row.certificado_estado !== 'BORRADOR' || row.entorno_facturador !== 'DEMO'
        || row.planta_key !== row.certificado_planta_key || !(row.estado === 'ERROR' || (cuotaDemo && row.estado === 'RECHAZADO')) || row.aceptada_sunat === true || row.tiene_bloqueo
        || row.enlace_pdf || row.enlace_xml || row.enlace_cdr || row.codigo_hash || row.estado_trabajo) return 'ESTADO_NO_ELEGIBLE';
    if (!row.serie || !row.intento_id || !coincideIdentidad(row, row.solicitud_origen)) return 'IDENTIDAD_FISCAL_INCOMPLETA';
    if (!row.fecha_original_vigente) return 'FECHA_FISCAL_REQUIERE_REVISION';
    if (!(row.diagnostico?.recuperable || cuotaDemo) || !row.diagnostico?.ausenciaConfirmada) return 'RESULTADO_REMOTO_NO_RESUELTO';
    return null;
};

const diagnosticoGuardado = (row) => {
    if (row.diagnostico?.categoria === 'LIMITE_DEMO_AGOTADO') return row.diagnostico;
    if (row.estado !== 'RECHAZADO' || !['', '0'].includes(String(row.sunat_responsecode || ''))) return row.diagnostico;
    const respuesta = row.respuesta_intento || {};
    const descripcion = identificarLimiteDemo(row.sunat_description, respuesta.errors,
        respuesta.emision?.errors, respuesta.sunat_description);
    return descripcion ? clasificarResultado({ status: 'REJECTED',
        data: { errors: descripcion } }, null, row.intento_id) : row.diagnostico;
};

const verificarCupoDemo = async (row, executor, revalidar = false) => {
    if (row.diagnostico?.categoria !== 'LIMITE_DEMO_AGOTADO'
        || (row.diagnostico.ausenciaConfirmada && !revalidar)) return;
    // Los estados técnicos ya fueron revisados antes de consultar la identidad fiscal.
    const emisor = require('./faregas-nubefact-config.service');
    const proveedor = require('../../../services/integrations/nubefact.service');
    row.diagnostico = { ...row.diagnostico, ausenciaConfirmada: false };
    try {
        const contexto = await emisor.resolverParaPlanta(row.planta_key, executor);
        if (contexto.environment !== 'DEMO' || contexto.empresaKey !== row.empresa_key
            || String(contexto.rucEmisor) !== String(row.ruc_emisor)) return;
        const consulta = await proveedor.consultarComprobante({
            tipoDeComprobante: row.solicitud_origen.tipo_de_comprobante,
            serie: row.serie,
            numero: row.numero
        }, { credentials: contexto.credentials });
        row.diagnostico.ausenciaConfirmada = ausenciaConfirmada(consulta);
    } catch {
        // Si el resultado remoto sigue incierto, la operación conserva el bloqueo.
    }
};

const validarOperadorContingencia = (user) => {
    if (!user || !user.username) return false;
    const ops = config.contingencia.operadoresDemo;
    if (!Array.isArray(ops) || ops.includes('*')) return false;
    const username = String(user.username).trim().toLowerCase();
    const enLista = ops.map(o => String(o).trim().toLowerCase()).includes(username);
    if (!enLista) return false;
    const perfil = String(user.perfil_id || '').trim().toUpperCase();
    return ['SISTEMAS', 'SUPERVISOR', 'OPERADOR'].includes(perfil);
};

const obtenerContexto = async (certificadoId, user) => {
    if (!config.contingencia.habilitada) return { habilitada: false, permiteSoloCertificado: false, motivo: 'CONTINGENCIA_NO_HABILITADA' };
    const row = await cargar(certificadoId);
    if (!row) return { habilitada: true, permiteSoloCertificado: false };
    const acceso = await auth.validarAccesoPlanta(user.username, user.perfil_id, row.certificado_planta_key);
    if (!acceso) throw error('PLANTA_NO_AUTORIZADA', 403);
    const operadorPermitido = validarOperadorContingencia(user);
    let motivo = operadorPermitido
        ? evaluar(row) : 'OPERADOR_CONTINGENCIA_NO_AUTORIZADO';
    if (motivo === 'RESULTADO_REMOTO_NO_RESUELTO') {
        await verificarCupoDemo(row, db);
        motivo = evaluar(row);
    }
    if (!motivo) {
        const servicio = require('./faregas-certificados.service');
        const validacion = await servicio.validarEmision(certificadoId, user, {
            ignorarComprobanteNoEmitido: true, ignorarChipNoConsumido: true, soloLectura: true
        });
        if (!validacion?.valido) motivo = 'CERTIFICADO_CON_OBSERVACIONES';
    }
    return {
        habilitada: true,
        permiteSoloCertificado: !motivo,
        motivo,
        diagnostico: row.diagnostico,
        estadoRegularizacion: row.estado_trabajo || null
    };
};

const autorizarEnTransaccion = async (client, certificadoId, user) => {
    if (!config.contingencia.habilitada) throw error('CONTINGENCIA_NO_HABILITADA', 403);
    if (!validarOperadorContingencia(user)) throw error('OPERADOR_CONTINGENCIA_NO_AUTORIZADO', 403);
    const doc = await cargar(certificadoId, client, true);
    if (doc?.certificado_estado === 'EMITIDO' && doc.estado_trabajo) return { ...doc, yaEmitido: true };
    let motivo = evaluar(doc);
    if (!motivo || motivo === 'RESULTADO_REMOTO_NO_RESUELTO') {
        await verificarCupoDemo(doc, client, true);
        motivo = evaluar(doc);
    }
    if (motivo) throw error(motivo);
    return doc;
};

const registrar = async (client, doc, username) => {
    await client.query(
        "INSERT INTO public.fg_facturacion_contingencia (facturacion_id, certificado_id, intento_origen_id, " +
        "operacion_id, planta_key, empresa_key, usuario_autorizacion, fecha_fiscal_original, diagnostico) " +
        "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)",
        [doc.id, doc.certificado_id, doc.intento_id, doc.operacion_id, doc.planta_key,
            doc.empresa_key, username, doc.fecha_original, JSON.stringify(doc.diagnostico)]
    );
    await client.query(
        "UPDATE public.fg_facturacion SET estado = 'PENDIENTE', usuario_modificacion = $2, " +
        "fecha_modificacion = now() WHERE id = $1",
        [doc.id, username]
    );
};

const listar = async (user, query = {}) => {
    if (!config.contingencia.habilitada) return { habilitada: false, items: [] };
    const plantas = (await auth.getPlantasPorUsuario(user.username, user.perfil_id)).map(p => p.key);
    const estado = ['PENDIENTE', 'REVISION', 'REGULARIZADO', 'CANCELADO'].includes(query.estado)
        ? query.estado : null;
    const pagina = Math.min(10000, Math.max(1, Math.floor(Number(query.pagina) || 1)));
    const { rows } = await db.query(
        "SELECT j.facturacion_id, j.certificado_id, c.numero_certificado, f.nro_comprobante, f.estado AS estado_fiscal, " +
        "j.planta_key, j.estado, j.diagnostico, j.intentos, j.ultimo_intento, j.siguiente_intento, " +
        "j.ultimo_resultado, j.correo_estado, j.correo_intentos, j.correo_proximo, j.correo_ultimo_error, j.fecha_regularizacion, " +
        "(j.estado IN ('PENDIENTE','REVISION') AND j.fecha_fiscal_original < (now() AT TIME ZONE 'America/Lima')::date) AS prioridad " +
        "FROM public.fg_facturacion_contingencia j JOIN public.fg_certificado c ON c.id = j.certificado_id " +
        "JOIN public.fg_facturacion f ON f.id = j.facturacion_id " +
        "WHERE j.planta_key = ANY($1::varchar[]) AND ($2::varchar IS NULL OR j.estado = $2) " +
        "ORDER BY prioridad DESC, j.fecha_autorizacion DESC, j.facturacion_id DESC LIMIT 51 OFFSET $3",
        [plantas, estado, (pagina - 1) * 50]
    );
    return { habilitada: true, items: rows.slice(0, 50), hayMas: rows.length > 50 };
};

const programar = async (facturacionId, user) => {
    if (!config.contingencia.habilitada) throw error('CONTINGENCIA_NO_HABILITADA', 403);
    const plantas = (await auth.getPlantasPorUsuario(user.username, user.perfil_id)).map(p => p.key);
    const result = await db.query(
        "UPDATE public.fg_facturacion_contingencia AS j SET siguiente_intento = now() " +
        "FROM public.fg_certificado c WHERE j.facturacion_id = $1 AND j.planta_key = ANY($2::varchar[]) " +
        "AND c.id = j.certificado_id AND c.estado = 'EMITIDO' AND j.estado = 'PENDIENTE' " +
        "AND j.fecha_fiscal_original = (now() AT TIME ZONE 'America/Lima')::date " +
        "AND (j.lease_hasta IS NULL OR j.lease_hasta <= now()) RETURNING j.facturacion_id",
        [facturacionId, plantas]
    );
    if (result.rowCount) return;

    const { rows: [trabajo] } = await db.query(
        "SELECT CASE " +
        "WHEN j.estado = 'REGULARIZADO' THEN 'REINTENTO_YA_REGULARIZADO' " +
        "WHEN j.estado = 'REVISION' THEN 'REINTENTO_REQUIERE_REVISION' " +
        "WHEN j.estado = 'CANCELADO' THEN 'REINTENTO_CANCELADO' " +
        "WHEN c.estado IS DISTINCT FROM 'EMITIDO' THEN 'REINTENTO_CERTIFICADO_NO_EMITIDO' " +
        "WHEN j.fecha_fiscal_original IS DISTINCT FROM (now() AT TIME ZONE 'America/Lima')::date THEN 'FECHA_FISCAL_REQUIERE_REVISION' " +
        "WHEN j.lease_hasta > now() THEN 'REINTENTO_EN_PROCESO' END AS motivo " +
        "FROM public.fg_facturacion_contingencia j JOIN public.fg_certificado c ON c.id = j.certificado_id " +
        "WHERE j.facturacion_id = $1 AND j.planta_key = ANY($2::varchar[])",
        [facturacionId, plantas]
    );
    if (!trabajo) throw error('REINTENTO_NO_ENCONTRADO', 404);
    throw error(trabajo.motivo || 'REINTENTO_NO_DISPONIBLE');
};

module.exports = { autorizarEnTransaccion, coincideIdentidad, error, evaluar, listar, obtenerContexto, programar, registrar };
