const documentosService = require('../services/faregas-documentos-electronicos.service');
const auditoriaService = require('../services/faregas-auditoria.service');
const autorizacionFiscalService = require('../services/faregas-autorizacion-fiscal.service');

const mensajes = {
    FACTURACION_FALTANTE: 'Primero debe guardar los datos de facturación.',
    PLANTA_NO_AUTORIZADA: 'No tiene acceso a la sede del certificado.',
    COMPROBANTE_NO_ACEPTADO: 'El comprobante original no está listo: PRODUCCIÓN requiere aceptación SUNAT y DEMO requiere generación completa en NubeFact.',
    COMPROBANTE_SIN_NUMERO: 'El comprobante no tiene una serie y número reservados.',
    TIPO_NOTA_INVALIDO: 'Seleccione nota de crédito o nota de débito.',
    MOTIVO_NOTA_INVALIDO: 'El código de motivo de la nota no es válido.',
    SUSTENTO_NOTA_INVALIDO: 'Ingrese un sustento de hasta 250 caracteres.',
    IMPORTES_NOTA_INVALIDOS: 'Los importes de la nota no son válidos.',
    NOTA_CREDITO_EXCEDE_COMPROBANTE: 'La nota de crédito supera el total del comprobante original.',
    NOTA_NO_ENCONTRADA: 'La nota electrónica no existe.',
    NOTA_NO_REINTENTABLE: 'Esta nota no se puede volver a emitir en su estado actual.',
    SERIE_NOTA_NO_CONFIGURADA: 'La sede no tiene una serie configurada para este tipo de nota.',
    SERIE_NOTA_INVALIDA: 'La serie o el correlativo de la nota no es válido.',
    NUBEFACT_NOTA_NO_ACEPTADA: 'Nubefact o SUNAT no aceptaron la nota electrónica.',
    MOTIVO_ANULACION_INVALIDO: 'Ingrese un motivo de anulación de hasta 100 caracteres.',
    TIPO_DOCUMENTO_ANULACION_INVALIDO: 'El tipo de documento a anular no es válido.',
    DOCUMENTO_NO_ANULABLE: 'El documento no está listo para anularse en el ambiente actual.',
    CERTIFICADO_IMPORTE_CERO_NO_ANULABLE: 'Este certificado tiene un importe final de S/ 0.00 y no admite anulación.',
    CERTIFICADO_IMPORTE_FINAL_NO_DETERMINABLE: 'No se pudo determinar el importe final del certificado. La anulación queda bloqueada hasta regularizar el importe.',
    PLAZO_ANULACION_VENCIDO: 'La anulación directa solo está disponible durante las 24 horas posteriores a la emisión. Para anular después, use una nota de crédito.',
    ANULACION_ACTIVA: 'Ya existe una solicitud de anulación en revisión para este comprobante.',
    ANULACION_NO_ENCONTRADA: 'La anulación solicitada no existe.',
    NUBEFACT_DESHABILITADO: 'La integración con Nubefact está deshabilitada.',
    NUBEFACT_NO_CONFIGURADO: 'Faltan la ruta o el token de Nubefact.',
    NUBEFACT_CONFIGURACION_PENDIENTE: 'Falta aplicar la configuración Nubefact por empresa.',
    EMPRESA_EMISORA_NO_CONFIGURADA: 'La sede no tiene una empresa emisora Nubefact activa.',
    EMPRESA_EMISORA_RUC_INVALIDO: 'El RUC de la empresa emisora no es válido.',
    NUBEFACT_CREDENCIALES_EMPRESA_FALTANTES: 'Faltan la ruta o el token Nubefact de la empresa emisora.',
    NUBEFACT_CREDENCIALES_RUC_FALTANTE: 'Declare el RUC al que pertenecen la ruta y el token Nubefact.',
    NUBEFACT_CREDENCIALES_RUC_NO_COINCIDE: 'El RUC de las credenciales Nubefact no coincide con la empresa emisora.',
    NUBEFACT_ENTORNO_INVALIDO: 'El ambiente Nubefact debe ser DEMO o PRODUCCION.',
    NUBEFACT_PRODUCCION_NO_CONFIRMADA: 'La activación productiva de Nubefact no fue confirmada.',
    NUBEFACT_ENVIO_SUNAT_DESHABILITADO: 'El envío productivo a SUNAT continúa deshabilitado.',
    NUBEFACT_DETRACCION_PENDIENTE_CONFIRMACION: 'La decisión tributaria sobre detracción continúa pendiente.',
    NUBEFACT_DETRACCION_CONFIGURACION_PENDIENTE: 'La detracción aplica, pero sus datos SPOT aún no están implementados.',
    MIGRACION_NUBEFACT_PENDIENTE: 'Falta aplicar la migración tributaria de Nubefact.',
    ENTORNO_NUBEFACT_INVALIDO: 'El ambiente de la serie Nubefact no es válido.',
    SERIE_NUBEFACT_NO_EXCLUSIVA: 'La serie no es exclusiva de Nubefact o pertenece a otro ambiente.',
    SERIE_PRODUCCION_NO_CONFIRMADA: 'La serie tributaria todavía no fue confirmada para producción.',
    NUBEFACT_RUTA_EMPRESA_INVALIDA: 'La ruta Nubefact de la empresa emisora no es válida.',
    FAREGAS_ANULACION_NO_AUTORIZADA: 'No tiene autorización para anular comprobantes electrónicos.',
    FAREGAS_SOLICITUD_FISCAL_REQUERIDA: 'Debe existir una solicitud administrativa aprobada antes de iniciar una acción fiscal.',
    FAREGAS_SOLICITUD_FISCAL_NO_ENCONTRADA: 'La solicitud fiscal no existe o no corresponde al certificado.',
    FAREGAS_EJECUCION_FISCAL_NO_AUTORIZADA: 'No tiene permiso efectivo para ejecutar esta acción fiscal.',
    SOLICITUD_SEPARACION_FUNCIONES_REQUERIDA: 'El solicitante no puede ejecutar su propia solicitud fiscal.',
    SOLICITUD_NO_APROBADA: 'La solicitud fiscal todavía no está aprobada.',
    SOLICITUD_TIPO_INCOMPATIBLE: 'La solicitud aprobada no autoriza este tipo de acción fiscal.',
    SOLICITUD_FISCAL_YA_PROCESADA: 'La solicitud fiscal ya tiene un resultado registrado.',
    DOCUMENTO_FISCAL_CORRECTIVO_EXISTENTE: 'Ya existe un documento fiscal correctivo activo para este comprobante.',
    FAREGAS_EJECUCION_FISCAL_FASE_4B_PENDIENTE: 'La autorización fue validada, pero la ejecución fiscal permanece deshabilitada hasta implementar la Fase 4B.',
    FAREGAS_OPERACION_FISCAL_INVALIDA: 'La operación fiscal solicitada no está habilitada.',
    NOTA_CREDITO_ANULACION_REQUIERE_SOLICITUD: 'Las notas de crédito por anulación de operación requieren una solicitud administrativa previa aprobada por Sistemas.'
};

const responderError = (res, error) => {
    const status = error.statusCode || 500;
    if (status >= 500) console.error('[FAREGAS DOCUMENTOS ELECTRONICOS]', error);
    return res.status(status).json({
        ok: false,
        codigo: error.code || error.message || 'ERROR_INTERNO',
        message: mensajes[error.code || error.message] || 'Error interno del servidor.',
        detalles: error.detalles || undefined
    });
};

const auditar = async (req, evento, entidad, entidadId, mensaje, datos = {}) => {
    await auditoriaService.registrarEventoCertificado(auditoriaService.contextoRequest(req, {
        certificado_id: Number(req.params.id),
        categoria: 'FACTURACION',
        evento,
        entidad,
        entidad_id: entidadId || null,
        mensaje,
        paso: 'FACTURACION',
        datos
    }));
};

exports.listar = async (req, res) => {
    try {
        const data = await documentosService.listarDocumentos(Number(req.params.id), req.user);
        return res.json({ ok: true, data });
    } catch (error) { return responderError(res, error); }
};

exports.consultarComprobante = async (req, res) => {
    try {
        const data = await documentosService.consultarFacturacion(Number(req.params.id), req.user);
        await auditar(req, 'COMPROBANTE_CONSULTADO', 'fg_facturacion', null,
            'Se consultó el estado del comprobante en Nubefact/SUNAT.', { estado: data.estado });
        return res.json({ ok: true, data });
    } catch (error) { return responderError(res, error); }
};

const MOTIVOS_ANULACION_OPERACION = new Set(['01', '1', '02', '2', '06', '6']);

exports.emitirNota = async (req, res) => {
    try {
        const tipo = String(req.body?.tipo || '').toUpperCase();
        const motivoCodigo = String(req.body?.motivoCodigo || req.body?.motivo_codigo || '').trim();
        const esAnulacionOperacion = tipo === 'CREDITO' && MOTIVOS_ANULACION_OPERACION.has(motivoCodigo);

        if (esAnulacionOperacion || req.body?.solicitudId) {
            if (!req.body?.solicitudId) {
                return res.status(403).json({
                    ok: false,
                    codigo: 'NOTA_CREDITO_ANULACION_REQUIERE_SOLICITUD',
                    message: 'Las notas de crédito que anulan la operación o invalidan el comprobante requieren una solicitud administrativa previa aprobada por Sistemas.'
                });
            }
            await autorizacionFiscalService.validarSolicitudAprobada({
                solicitudId: req.body?.solicitudId,
                certificadoId: Number(req.params.id),
                operacion: 'NOTA_CORRECTIVA',
                userContext: req.user
            });
        } else {
            // Motivos no anulatorios (ej. 03 corrección de descripción):
            // Requieren justificación funcional explícita
            const sustento = String(req.body?.sustento || '').trim();
            if (!sustento || sustento.length < 5 || sustento === 'CORRECCIÓN DE DESCRIPCIÓN') {
                return res.status(400).json({
                    ok: false,
                    codigo: 'SUSTENTO_NOTA_INVALIDO',
                    message: 'Debe ingresar un sustento descriptivo válido para la emisión de la nota de crédito.'
                });
            }
        }

        const data = await documentosService.emitirNota(Number(req.params.id), tipo, req.body || {}, req.user);
        await auditar(req, `NOTA_${tipo}_EMITIDA`, tipo === 'CREDITO' ? 'fg_credito' : 'fg_debito', data.id,
            `Se procesó una nota de ${tipo === 'CREDITO' ? 'crédito' : 'débito'}.`, { estado: data.estado, comprobante: data.nroComprobante, motivoCodigo });
        return res.json({ ok: true, data });
    } catch (error) { return responderError(res, error); }
};

exports.reintentarNota = async (req, res) => {
    try {
        const tipo = String(req.params.tipo || '').toUpperCase();
        const notaId = Number(req.params.notaId);
        const data = await documentosService.reintentarNota(Number(req.params.id), tipo, notaId, req.user);
        await auditar(req, `NOTA_${tipo}_REINTENTADA`, tipo === 'CREDITO' ? 'fg_credito' : 'fg_debito', data.id,
            'Se reintentó la emisión de una nota electrónica.', { estado: data.estado, comprobante: data.nroComprobante });
        return res.json({ ok: true, data });
    } catch (error) { return responderError(res, error); }
};

exports.generarAnulacion = async (req, res) => {
    try {
        if (!req.body?.solicitudId) {
            return res.status(403).json({
                ok: false,
                codigo: 'FAREGAS_SOLICITUD_FISCAL_REQUERIDA',
                message: 'La anulación de comprobante requiere una solicitud administrativa previa aprobada por Sistemas.'
            });
        }
        await autorizacionFiscalService.validarSolicitudAprobada({
            solicitudId: req.body?.solicitudId,
            certificadoId: Number(req.params.id),
            operacion: 'ANULACION_COMPROBANTE',
            userContext: req.user
        });
        const data = await documentosService.generarAnulacion(Number(req.params.id), req.body || {}, req.user);
        await auditar(req, 'DOCUMENTO_ANULACION_ENVIADA', 'fg_documento_anulacion', data.id,
            'Se envió una solicitud de anulación a Nubefact/SUNAT.', {
                estado: data.estado,
                tipoDocumento: String(req.body?.tipoDocumento || '').toUpperCase(),
                motivo: String(req.body?.motivo || '').trim()
            });
        return res.json({ ok: true, data });
    } catch (error) { return responderError(res, error); }
};

exports.consultarAnulacion = async (req, res) => {
    try {
        const data = await documentosService.consultarAnulacion(Number(req.params.id), Number(req.params.anulacionId), req.user);
        await auditar(req, 'DOCUMENTO_ANULACION_CONSULTADA', 'fg_documento_anulacion', Number(req.params.anulacionId),
            'Se consultó el estado de una anulación.', { estado: data.estado });
        return res.json({ ok: true, data });
    } catch (error) { return responderError(res, error); }
};

const auditarOperacion = async (req, evento, entidadId, mensaje, datos = {}) => {
    await auditoriaService.registrarEvento(auditoriaService.contextoRequest(req, {
        categoria: 'FACTURACION',
        evento,
        entidad: 'fg_operacion_comercial',
        entidad_id: Number(req.params.operacionId),
        mensaje,
        paso: 'VENTA_CHIPS',
        datos: { documentoAnulacionId: entidadId || null, ...datos }
    }));
};

exports.generarAnulacionOperacion = async (req, res) => {
    try {
        autorizacionFiscalService.exigirSolicitudAdministrativaDisponible();
        const data = await documentosService.generarAnulacionOperacion(
            Number(req.params.operacionId), req.body || {}, req.user
        );
        await auditarOperacion(req, 'DOCUMENTO_ANULACION_ENVIADA', data.id,
            'Se envió una solicitud de anulación del comprobante de venta de chips.', {
                estado: data.estado,
                tipoDocumento: String(req.body?.tipoDocumento || '').toUpperCase(),
                motivo: String(req.body?.motivo || '').trim()
            });
        return res.json({ ok: true, data });
    } catch (error) { return responderError(res, error); }
};

exports.consultarAnulacionOperacion = async (req, res) => {
    try {
        const data = await documentosService.consultarAnulacionOperacion(
            Number(req.params.operacionId), Number(req.params.anulacionId), req.user
        );
        await auditarOperacion(req, 'DOCUMENTO_ANULACION_CONSULTADA', Number(req.params.anulacionId),
            'Se consultó la anulación del comprobante de venta de chips.', { estado: data.estado });
        return res.json({ ok: true, data });
    } catch (error) { return responderError(res, error); }
};
