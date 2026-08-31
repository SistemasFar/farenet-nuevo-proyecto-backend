const documentosService = require('../services/faregas-documentos-electronicos.service');
const auditoriaService = require('../services/faregas-auditoria.service');

const mensajes = {
    FACTURACION_FALTANTE: 'Primero debe guardar los datos de facturación.',
    PLANTA_NO_AUTORIZADA: 'No tiene acceso a la sede del certificado.',
    COMPROBANTE_NO_ACEPTADO: 'El comprobante original todavía no fue aceptado por SUNAT.',
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
    DOCUMENTO_NO_ANULABLE: 'Solo se puede anular un documento aceptado.',
    ANULACION_NO_ENCONTRADA: 'La anulación solicitada no existe.',
    NUBEFACT_DESHABILITADO: 'La integración con Nubefact está deshabilitada.',
    NUBEFACT_NO_CONFIGURADO: 'Faltan la ruta o el token de Nubefact.',
    NUBEFACT_CONFIGURACION_PENDIENTE: 'Falta aplicar la configuración Nubefact por empresa.',
    EMPRESA_EMISORA_NO_CONFIGURADA: 'La sede no tiene una empresa emisora Nubefact activa.',
    EMPRESA_EMISORA_RUC_INVALIDO: 'El RUC de la empresa emisora no es válido.',
    NUBEFACT_CREDENCIALES_EMPRESA_FALTANTES: 'Faltan la ruta o el token Nubefact de la empresa emisora.',
    NUBEFACT_RUTA_EMPRESA_INVALIDA: 'La ruta Nubefact de la empresa emisora no es válida.'
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

exports.emitirNota = async (req, res) => {
    try {
        const tipo = String(req.body?.tipo || '').toUpperCase();
        const data = await documentosService.emitirNota(Number(req.params.id), tipo, req.body || {}, req.user);
        await auditar(req, `NOTA_${tipo}_EMITIDA`, tipo === 'CREDITO' ? 'fg_credito' : 'fg_debito', data.id,
            `Se procesó una nota de ${tipo === 'CREDITO' ? 'crédito' : 'débito'}.`, { estado: data.estado, comprobante: data.nroComprobante });
        return res.json({ ok: true, data });
    } catch (error) { return responderError(res, error); }
};

exports.reintentarNota = async (req, res) => {
    try {
        const tipo = String(req.params.tipo || '').toUpperCase();
        const data = await documentosService.reintentarNota(Number(req.params.id), tipo, Number(req.params.notaId), req.user);
        await auditar(req, `NOTA_${tipo}_REINTENTADA`, tipo === 'CREDITO' ? 'fg_credito' : 'fg_debito', data.id,
            'Se reintentó la emisión de una nota electrónica.', { estado: data.estado, comprobante: data.nroComprobante });
        return res.json({ ok: true, data });
    } catch (error) { return responderError(res, error); }
};

exports.generarAnulacion = async (req, res) => {
    try {
        const data = await documentosService.generarAnulacion(Number(req.params.id), req.body || {}, req.user);
        await auditar(req, 'DOCUMENTO_ANULACION_ENVIADA', 'fg_documento_anulacion', data.id,
            'Se envió una solicitud de anulación a Nubefact/SUNAT.', { estado: data.estado });
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
