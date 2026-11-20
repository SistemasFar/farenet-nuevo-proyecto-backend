const contingencia = require('../services/faregas-contingencia.service');
const certificados = require('../services/faregas-certificados.service');
const auditoria = require('../services/faregas-auditoria.service');
const worker = require('../services/faregas-contingencia-worker.service');

const leerId = (value) => {
    const id = Number(value);
    if (!Number.isSafeInteger(id) || id <= 0) throw contingencia.error('IDENTIFICADOR_INVALIDO', 400);
    return id;
};

const motivos = {
    IDENTIFICADOR_INVALIDO: 'El número de registro es inválido. Abre el registro desde el listado de FAREGAS.',
    CONTINGENCIA_NO_HABILITADA: 'La emisión excepcional está desactivada en este entorno. Consulta con Sistemas si corresponde habilitarla en DEMO.',
    OPERADOR_CONTINGENCIA_NO_AUTORIZADO: 'Tu usuario no está autorizado para emitir en contingencia. Solicita a un operador autorizado que revise el borrador.',
    PLANTA_NO_AUTORIZADA: 'Tu usuario no tiene acceso a la sede del certificado.',
    TIPO_SIN_AUTORIZACION_DEMO: 'El tipo o la modalidad del certificado no está habilitado para contingencia DEMO. Solicita a Sistemas que revise la configuración.',
    RESULTADO_REMOTO_NO_RESUELTO: 'Todavía no se ha confirmado en NubeFact si el comprobante fue generado. Consulta su estado antes de intentar emitir de nuevo.',
    IDENTIDAD_FISCAL_INCOMPLETA: 'No se pudo verificar la serie, el número o el intento original del comprobante. Solicita a Facturación que revise el registro.',
    FECHA_FISCAL_REQUIERE_REVISION: 'La fecha fiscal original requiere revisión. Solicita a Facturación que evalúe cómo regularizar el comprobante.',
    CERTIFICADO_NOT_FOUND: 'El certificado indicado no existe. Actualiza el listado y comprueba la sede activa.',
    NO_VALIDO_PARA_EMISION: 'El certificado tiene observaciones técnicas pendientes. Abre Vehículo y Datos Técnicos y corrige los campos señalados.',
    ESTADO_INVALIDO: 'El certificado ya no admite la emisión desde este borrador. Actualiza el registro y consulta su estado actual.',
    ESTADO_NO_ELEGIBLE: 'El estado actual del certificado o del comprobante bloquea la emisión excepcional. Consulta ambos estados en Facturación.',
    REINTENTO_YA_REGULARIZADO: 'El comprobante ya se regularizó. Actualiza la fila para ver el resultado.',
    REINTENTO_REQUIERE_REVISION: 'El comprobante quedó en revisión manual. Abre Facturación y revisa el resultado del último intento.',
    REINTENTO_CANCELADO: 'La regularización está cancelada. Consulta el historial en Facturación.',
    REINTENTO_CERTIFICADO_NO_EMITIDO: 'El certificado asociado ya no figura como emitido. Revisa el estado del certificado antes de continuar.',
    REINTENTO_EN_PROCESO: 'Otro proceso está regularizando el comprobante. Actualiza la fila cuando termine.',
    REINTENTO_NO_ENCONTRADO: 'No se encontró la regularización en tus sedes autorizadas. Actualiza el listado y revisa la sede.',
    REINTENTO_NO_DISPONIBLE: 'No se pudo programar el intento. Actualiza la fila y verifica si el estado cambió antes de repetirlo.'
};

const responder = (res, error) => {
    if (!error.statusCode) console.error('[FAREGAS_CONTINGENCIA]', error.code || 'ERROR_INTERNO');
    const status = error.statusCode || 500;
    const codigo = error.code || error.message;
    return res.status(status).json({
        ok: false,
        codigo: status < 500 ? codigo : 'ERROR_INTERNO_FAREGAS',
        message: status < 500 && Object.hasOwn(motivos, codigo) ? motivos[codigo]
            : 'No se pudo consultar o actualizar la contingencia. Revisa el estado antes de reintentar.'
    });
};

exports.contexto = async (req, res) => {
    try {
        const data = await contingencia.obtenerContexto(leerId(req.params.id), req.user);
        return res.json({ ok: true, data });
    } catch (error) { return responder(res, error); }
};

exports.emitirSoloCertificado = async (req, res) => {
    try {
        const id = leerId(req.params.id);
        const data = await certificados.emitirCertificado(id, req.user, { contingencia: true });
        if (!data.recuperado) {
            await auditoria.registrarEventoCertificado(auditoria.contextoRequest(req, {
                certificado_id: id,
                entidad: 'fg_certificado',
                entidad_id: id,
                categoria: 'EMISION',
                evento: 'CERTIFICADO_EMITIDO',
                mensaje: 'Certificado emitido en contingencia DEMO. La facturación queda pendiente.',
                datos: { numeroCertificado: data.numero_certificado, contingencia: true }
            })).catch(() => console.error('[FAREGAS_CONTINGENCIA] AUDITORIA_NO_REGISTRADA'));
        }
        return res.json({ ok: true, data });
    } catch (error) {
        if (!error.statusCode && ['CERTIFICADO_NOT_FOUND','PLANTA_NO_AUTORIZADA','NO_VALIDO_PARA_EMISION','ESTADO_INVALIDO'].includes(error.message)) {
            error.statusCode = error.message === 'PLANTA_NO_AUTORIZADA' ? 403
                : error.message === 'CERTIFICADO_NOT_FOUND' ? 404 : 409;
        }
        return responder(res, error);
    }
};

exports.listar = async (req, res) => {
    try { return res.json({ ok: true, data: await contingencia.listar(req.user, req.query) }); }
    catch (error) { return responder(res, error); }
};

exports.reintentar = async (req, res) => {
    try {
        const facturacionId = leerId(req.params.facturacionId);
        await contingencia.programar(facturacionId, req.user);
        const data = await worker.procesarLote({ facturacionId });
        return res.json({ ok: true, data });
    } catch (error) { return responder(res, error); }
};
