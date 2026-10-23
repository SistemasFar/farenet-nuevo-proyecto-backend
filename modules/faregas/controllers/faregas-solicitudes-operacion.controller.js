const solicitudesService = require('../services/faregas-solicitudes-operacion.service');
const auditoriaService = require('../services/faregas-auditoria.service');

const MENSAJES = {
    CAMPO_OBLIGATORIO: 'Complete los campos obligatorios.',
    TEXTO_DEMASIADO_LARGO: 'Uno de los textos supera la longitud permitida.',
    IDENTIFICADOR_INVALIDO: 'El identificador indicado no es válido.',
    CERTIFICADO_ID_INVALIDO: 'El certificado indicado no es válido.',
    SOLICITUD_ID_INVALIDO: 'La solicitud indicada no es válida.',
    TIPO_SOLICITUD_INVALIDO: 'Seleccione un tipo de solicitud válido.',
    TIPO_SOLICITUD_NO_DISPONIBLE: 'El único trámite disponible es la anulación total del certificado y su comprobante asociado.',
    DATOS_PROPUESTOS_NO_PERMITIDOS: 'La anulación total no admite cambios de datos técnicos ni fiscales.',
    ESTADO_SOLICITUD_INVALIDO: 'El estado de solicitud no es válido.',
    IDEMPOTENCIA_INVALIDA: 'No se pudo validar la operación. Actualice la página e intente nuevamente.',
    IDEMPOTENCIA_REUTILIZADA: 'La clave de control ya fue utilizada para otra solicitud.',
    DATOS_PROPUESTOS_REQUERIDOS: 'Describa los datos propuestos para la rectificación.',
    DATOS_PROPUESTOS_DEMASIADO_GRANDES: 'Los datos propuestos superan el tamaño permitido.',
    DATO_PROPUESTO_PROHIBIDO: 'Los datos propuestos contienen un campo protegido.',
    CERTIFICADO_NO_ENCONTRADO: 'El certificado no existe.',
    SOLICITUD_CERTIFICADO_NO_EMITIDO: 'Solo se pueden crear solicitudes sobre certificados emitidos.',
    SOLICITUD_COMPROBANTE_REQUERIDO: 'Este tipo de solicitud requiere un comprobante relacionado.',
    SOLICITUD_INCOMPATIBLE_ACTIVA: 'Ya existe una solicitud activa o aprobada pendiente de ejecución para este documento.',
    SOLICITUD_NO_ENCONTRADA: 'La solicitud no existe.',
    SOLICITUD_PERMISO_DENEGADO: 'No tiene autorización para realizar esta acción.',
    SOLICITUD_SEDE_NO_AUTORIZADA: 'No tiene acceso a la sede de esta solicitud.',
    SOLICITUD_AUTODECISION_PROHIBIDA: 'El solicitante no puede aprobar ni rechazar su propia solicitud.',
    SOLICITUD_DECISION_EXCLUSIVA_SISTEMAS: 'Sólo un usuario SISTEMAS puede aprobar o rechazar solicitudes de anulación total.',
    SOLICITUD_TIPO_HISTORICO_SOLO_LECTURA: 'Las solicitudes de tipos anteriores se conservan únicamente como historial y ya no admiten acciones.',
    SOLICITUD_NO_DECIDIBLE: 'La solicitud ya fue decidida o cancelada.',
    SOLICITUD_NO_CANCELABLE: 'La solicitud ya no puede cancelarse.',
    SOLICITUD_VERSION_DESACTUALIZADA: 'La solicitud fue modificada por otro usuario. Actualice la información.',
    SOLICITUD_DECISION_CONCURRENTE: 'Otro usuario ya tomó una decisión sobre la solicitud.',
    VERSION_SOLICITUD_INVALIDA: 'La versión de la solicitud no es válida.',
    USUARIO_NO_ENCONTRADO: 'La sesión ya no corresponde a un usuario válido.',
    USUARIO_INACTIVO: 'El usuario se encuentra inactivo.',
    SOLICITUD_NO_APROBADA: 'Solo se puede ejecutar una solicitud previamente aprobada.',
    SOLICITUD_RECHAZADA: 'La solicitud fue rechazada y no puede ejecutarse.',
    SOLICITUD_CANCELADA: 'La solicitud fue cancelada y no puede ejecutarse.',
    SOLICITUD_ESTADO_INVALIDO: 'El estado de la solicitud no permite la ejecución técnica.',
    TIPO_OPERACION_INVALIDO_PARA_EJECUCION: 'Esta acción solo corresponde a solicitudes de anulación de certificado.',
    CERTIFICADO_NO_EMITIDO: 'El certificado no se encuentra emitido.',
    CERTIFICADO_YA_ANULADO: 'El certificado ya se encuentra anulado.',
    CERTIFICADO_SIN_NUMERO_DG: 'El certificado no cuenta con número correlativo DG asignado.',
    ANULACION_REQUIERE_VALIDACION_EXTERNA: 'Este tipo de certificado requiere confirmación previa de la entidad externa competente.',
    SOLICITUD_EMPRESA_NO_AUTORIZADA: 'No tiene acceso a la empresa de esta solicitud.',
    DOCUMENTO_ORIGINAL_MODIFICADO: 'El certificado original fue modificado después de creada la solicitud. Se requiere nueva revisión.',
    PROPUESTA_SIN_DIFERENCIAS: 'Los datos propuestos no presentan diferencias con el certificado original.',
    CAMPO_NO_RECTIFICABLE: 'Uno de los campos propuestos no está permitido para rectificación.',
    VERSION_RECTIFICACION_NO_ENCONTRADA: 'La versión técnica de rectificación no existe.',
    SOLICITUD_EJECUCION_EN_CURSO: 'La solicitud ya se encuentra en proceso de ejecución por otro usuario.'
};

const responderError = (res, error) => {
    if (error?.code === '42P01' || error?.code === '42703') {
        return res.status(503).json({
            ok: false,
            codigo: 'FAREGAS_SOLICITUDES_NO_DISPONIBLES',
            message: 'El módulo de solicitudes todavía no está habilitado en este ambiente.'
        });
    }
    const status = error.statusCode || 500;
    if (status >= 500) console.error('[FAREGAS SOLICITUDES OPERACION]', error);
    return res.status(status).json({
        ok: false,
        codigo: error.code || 'ERROR_INTERNO',
        message: MENSAJES[error.code] || 'No se pudo procesar la solicitud.',
        detalles: error.detalles
    });
};

const auditar = async (req, evento, solicitud, mensaje) => {
    await auditoriaService.registrarEvento(auditoriaService.contextoRequest(req, {
        categoria: 'SOLICITUD_ADMINISTRATIVA',
        evento,
        entidad: 'fg_solicitud_operacion',
        entidad_id: solicitud?.id || null,
        certificado_id: solicitud?.certificadoId || Number(req.body?.certificadoId) || null,
        planta_key: solicitud?.plantaKey || null,
        numero_certificado: solicitud?.numeroCertificado || null,
        mensaje,
        paso: 'ADMINISTRACION_DOCUMENTOS',
        datos: solicitud ? {
            tipoOperacion: solicitud.tipoOperacion,
            estado: solicitud.estado,
            version: solicitud.version
        } : null
    }));
};

exports.contextoCertificado = async (req, res) => {
    try {
        const data = await solicitudesService.contextoCertificado(req.params.certificadoId, req.user);
        return res.json({ ok: true, data });
    } catch (error) { return responderError(res, error); }
};

exports.crear = async (req, res) => {
    try {
        const resultado = await solicitudesService.crearAnulacionTotal(req.body || {}, req.user);
        await auditar(req, resultado.creada ? 'SOLICITUD_CREADA' : 'SOLICITUD_IDEMPOTENTE', resultado.solicitud,
            resultado.creada ? 'Se registró una solicitud administrativa.' : 'Se recuperó una solicitud ya registrada.');
        return res.status(resultado.creada ? 201 : 200).json({ ok: true, data: resultado.solicitud, creada: resultado.creada });
    } catch (error) { return responderError(res, error); }
};

exports.listar = async (req, res) => {
    try {
        const data = await solicitudesService.listar(req.query || {}, req.user);
        return res.json({ ok: true, ...data });
    } catch (error) { return responderError(res, error); }
};

exports.obtener = async (req, res) => {
    try {
        const data = await solicitudesService.obtener(req.params.id, req.user);
        return res.json({ ok: true, data });
    } catch (error) { return responderError(res, error); }
};

exports.aprobar = async (req, res) => {
    try {
        const data = await solicitudesService.aprobar(req.params.id, req.body || {}, req.user);
        await auditar(req, 'SOLICITUD_APROBADA', data, 'Se aprobó administrativamente una solicitud; permanece pendiente de ejecución.');
        return res.json({ ok: true, data });
    } catch (error) { return responderError(res, error); }
};

exports.rechazar = async (req, res) => {
    try {
        const data = await solicitudesService.rechazar(req.params.id, req.body || {}, req.user);
        await auditar(req, 'SOLICITUD_RECHAZADA', data, 'Se rechazó una solicitud administrativa.');
        return res.json({ ok: true, data });
    } catch (error) { return responderError(res, error); }
};

exports.cancelar = async (req, res) => {
    try {
        const data = await solicitudesService.cancelar(req.params.id, req.body || {}, req.user);
        await auditar(req, 'SOLICITUD_CANCELADA', data, 'Se canceló una solicitud administrativa pendiente.');
        return res.json({ ok: true, data });
    } catch (error) { return responderError(res, error); }
};

exports.historial = async (req, res) => {
    try {
        const data = await solicitudesService.historial(req.params.id, req.user);
        return res.json({ ok: true, data });
    } catch (error) { return responderError(res, error); }
};

exports.ejecutarAnulacionCertificado = async (req, res) => {
    try {
        const resultado = await solicitudesService.ejecutarAnulacionCertificado(req.params.id, req.body || {}, req.user);
        await auditar(req, 'CERTIFICADO_ANULADO_TECNICAMENTE', resultado.solicitud,
            resultado.yaCompletada
                ? 'Se consultó una anulación técnica ya ejecutada.'
                : 'Se ejecutó la anulación técnica del certificado emitido.');
        return res.json({ ok: true, data: resultado.solicitud, certificado: resultado.certificado });
    } catch (error) { return responderError(res, error); }
};

exports.ejecutarRectificacionCertificado = async (req, res) => {
    try {
        const resultado = await solicitudesService.ejecutarRectificacionCertificado(req.params.id, req.body || {}, req.user);
        await auditar(req, resultado.oficialAplicado ? 'CERTIFICADO_RECTIFICADO_OFICIALMENTE' : 'VERSION_RECTIFICACION_PREPARADA',
            resultado.solicitud,
            resultado.oficialAplicado
                ? 'Se aplicó oficialmente la rectificación técnica del certificado emitido.'
                : 'Se preparó la versión técnica de rectificación (pendiente de confirmación normativa).');
        return res.json({
            ok: true,
            data: resultado.solicitud,
            certificado: resultado.certificado,
            version: resultado.version,
            oficialAplicado: resultado.oficialAplicado,
            requiereIntervencion: resultado.requiereIntervencion
        });
    } catch (error) { return responderError(res, error); }
};

exports.ejecutarAnulacionTotal = async (req, res) => {
    try {
        const resultado = await solicitudesService.ejecutarAnulacionTotal(req.params.id, req.body || {}, req.user);
        await auditar(req, 'SOLICITUD_ANULACION_TOTAL_EJECUTADA', resultado.solicitud,
            resultado.yaCompletada
                ? 'Se consultó una anulación total ya ejecutada.'
                : (resultado.completada
                    ? 'Se ejecutó la anulación total de certificado y comprobante.'
                    : 'Se ejecutó la regularización autorizada (requiere intervención para conclusión técnica).'));
        return res.json({
            ok: true,
            data: resultado.solicitud,
            resultadoFiscal: resultado.resultadoFiscal,
            resultadoTecnico: resultado.resultadoTecnico,
            completada: resultado.completada,
            requiereIntervencion: resultado.requiereIntervencion,
            yaCompletada: resultado.yaCompletada || false
        });
    } catch (error) { return responderError(res, error); }
};

exports._private = { responderError };
