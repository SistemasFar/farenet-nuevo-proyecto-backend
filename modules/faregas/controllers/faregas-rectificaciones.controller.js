const service = require('../services/faregas-rectificaciones.service');
const auditoriaService = require('../services/faregas-auditoria.service');

const MENSAJES = {
    CERTIFICADO_NO_ENCONTRADO: 'El certificado indicado no existe.',
    CERTIFICADO_ID_INVALIDO: 'El certificado indicado no es válido.',
    SOLICITUD_ID_INVALIDO: 'La solicitud indicada no es válida.',
    SOLICITUD_NO_ENCONTRADA: 'La solicitud no existe.',
    SOLICITUD_PERMISO_DENEGADO: 'No tiene autorización para realizar esta acción.',
    PLANTA_NO_AUTORIZADA: 'No tiene acceso a la sede de este certificado.',
    CERTIFICADO_NO_DISPONIBLE_PARA_RECTIFICACION: 'El certificado no está disponible para rectificación.',
    CERTIFICADO_NO_EMITIDO_O_NO_RECTIFICABLE: 'Solo se pueden rectificar certificados emitidos.',
    CERTIFICADO_ANULADO: 'El certificado está anulado y no puede rectificarse.',
    ANULACION_EN_CURSO: 'El certificado tiene una anulación en curso.',
    RECTIFICACION_EN_CURSO: 'El certificado ya tiene una rectificación activa.',
    DATOS_PROPUESTOS_REQUERIDOS: 'Ingrese los datos que desea rectificar.',
    DATOS_PROPUESTOS_DEMASIADO_GRANDES: 'Los datos propuestos superan el tamaño permitido.',
    DATO_PROPUESTO_PROHIBIDO: 'Los datos propuestos contienen un campo protegido.',
    CAMPO_NO_RECTIFICABLE: 'Uno de los campos propuestos no está permitido para rectificación.',
    SIN_CAMBIOS_PARA_RECTIFICAR: 'No se detectaron cambios respecto del certificado original.',
    COMPONENTES_INVALIDOS: 'La lista de componentes no es válida.',
    VERIFICACIONES_INVALIDAS: 'La lista de verificaciones no es válida.',
    DATOS_FORMATO_INVALIDOS: 'Los datos del formato no son válidos.',
    FECHA_INVALIDA: 'Una de las fechas indicadas no es válida.',
    IDEMPOTENCIA_INVALIDA: 'No se pudo validar la operación. Actualice la página e intente nuevamente.',
    IDEMPOTENCIA_CONFLICTIVA: 'La clave de control ya fue utilizada para otra operación.',
    SOLICITUD_NO_APROBADA: 'La solicitud debe encontrarse aprobada antes de ejecutarse.',
    SOLICITUD_TIPO_NO_RECTIFICACION: 'La solicitud no corresponde a una rectificación de certificado.',
    SOLICITUD_VERSION_DESACTUALIZADA: 'La solicitud fue modificada por otro usuario. Actualice la información.',
    CERTIFICADO_MODIFICADO_DESDE_SOLICITUD: 'El certificado cambió desde que se creó la solicitud. Debe revisarse nuevamente.',
    VERSION_CERTIFICADO_NO_ENCONTRADA: 'La versión solicitada no existe.',
    PDF_VERSION_NO_DISPONIBLE: 'El PDF histórico de esta versión no está disponible.',
    TEXTO_DEMASIADO_LARGO: 'Uno de los textos supera la longitud permitida.',
    CAMPO_OBLIGATORIO: 'Complete los campos obligatorios.',
    USUARIO_NO_ENCONTRADO: 'La sesión ya no corresponde a un usuario válido.',
    USUARIO_INACTIVO: 'El usuario se encuentra inactivo.'
};

const responderError = (res, error) => {
    if (error?.code === '42P01' || error?.code === '42703') {
        return res.status(503).json({
            ok: false,
            codigo: 'FAREGAS_RECTIFICACIONES_NO_DISPONIBLES',
            message: 'El módulo de rectificaciones todavía no está habilitado en este ambiente.'
        });
    }
    const status = error?.statusCode || 500;
    if (status >= 500) console.error('[FAREGAS RECTIFICACIONES]', error);
    return res.status(status).json({
        ok: false,
        codigo: error?.code || 'ERROR_INTERNO',
        message: MENSAJES[error?.code] || 'No se pudo procesar la rectificación.',
        detalles: error?.detalles
    });
};

const auditar = async (req, evento, detalle) => {
    try {
        await auditoriaService.registrarEventoCertificado(auditoriaService.contextoRequest(req, {
            certificado_id: Number(detalle?.certificadoId || req.params?.id),
            evento,
            mensaje: detalle?.mensaje || null,
            datos: detalle?.datos || null
        }));
    } catch (error) {
        console.error('[FAREGAS RECTIFICACION AUDITORIA]', error.message);
    }
};

exports.contexto = async (req, res) => {
    try {
        const data = await service.obtenerContextoRectificacion(req.params.id, req.user);
        return res.json({ ok: true, data });
    } catch (error) {
        return responderError(res, error);
    }
};

exports.historial = async (req, res) => {
    try {
        const data = await service.obtenerHistorialRectificacion(req.params.id, req.user);
        return res.json({ ok: true, data });
    } catch (error) {
        return responderError(res, error);
    }
};

exports.previsualizar = async (req, res) => {
    try {
        const data = await service.previsualizarRectificacion(
            req.params.id,
            req.body?.datosPropuestos,
            req.user
        );
        return res.json({ ok: true, data });
    } catch (error) {
        return responderError(res, error);
    }
};

exports.crear = async (req, res) => {
    try {
        const data = await service.crearSolicitudRectificacion(req.params.id, req.body, req.user);
        await auditar(req, 'RECTIFICACION_SOLICITADA', {
            certificadoId: req.params.id,
            mensaje: 'Se registró una solicitud de rectificación técnica.',
            datos: {
                solicitudId: data?.solicitud?.id || null,
                diferencias: data?.diferencias || [],
                creada: data?.creada === true
            }
        });
        return res.status(data?.creada === false ? 200 : 201).json({ ok: true, data });
    } catch (error) {
        return responderError(res, error);
    }
};

exports.ejecutarDirecta = async (req, res) => {
    try {
        const data = await service.ejecutarRectificacionDirecta(req.params.id, req.body, req.user);
        await auditar(req, 'RECTIFICACION_DIRECTA_EJECUTADA', {
            certificadoId: req.params.id,
            mensaje: 'Se aplicó directamente la rectificación técnica y se generó una nueva versión del certificado.',
            datos: {
                registroId: data?.solicitud?.id || null,
                version: data?.version?.numeroVersion || data?.resultado?.version || null,
                enlacePdfVersion: data?.resultado?.enlacePdfVersion || null,
                fechaEmisionOriginal: data?.resultado?.fechaEmisionOriginal || null,
                fechaAplicacionOficial: data?.resultado?.fechaAplicacionOficial || null,
                sinCambiosFiscales: true,
                flujo: 'DIRECTO'
            }
        });
        return res.status(data?.yaCompletada ? 200 : 201).json({ ok: true, data });
    } catch (error) {
        return responderError(res, error);
    }
};

exports.ejecutar = async (req, res) => {
    try {
        const data = await service.ejecutarRectificacionSolicitud(req.params.id, req.body, req.user);
        await auditar(req, 'RECTIFICACION_EJECUTADA', {
            certificadoId: data?.solicitud?.certificadoId,
            mensaje: 'Se aplicó la rectificación técnica y se generó una nueva versión del certificado.',
            datos: {
                solicitudId: data?.solicitud?.id || null,
                version: data?.version?.numeroVersion || data?.resultado?.version || null,
                enlacePdfVersion: data?.resultado?.enlacePdfVersion || null,
                fechaEmisionOriginal: data?.resultado?.fechaEmisionOriginal || null,
                fechaAplicacionOficial: data?.resultado?.fechaAplicacionOficial || null,
                sinCambiosFiscales: true
            }
        });
        return res.json({ ok: true, data });
    } catch (error) {
        return responderError(res, error);
    }
};

exports.descargarPdfVersion = async (req, res) => {
    try {
        const data = await service.descargarPdfVersionRectificacion(
            req.params.id,
            req.params.versionId,
            req.user
        );
        return res.download(data.pdfPath, data.filename);
    } catch (error) {
        return responderError(res, error);
    }
};
