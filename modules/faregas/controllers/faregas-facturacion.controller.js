const facturacionService = require('../services/faregas-facturacion.service');
const auditoriaService = require('../services/faregas-auditoria.service');

const responderError = (res, error) => {
    const status = error.statusCode || 500;
    const messages = {
        CERTIFICADO_NOT_FOUND: 'El certificado no existe.',
        PLANTA_NO_AUTORIZADA: 'No tiene acceso a la planta del certificado.',
        CERTIFICADO_NO_EDITABLE: 'El certificado ya no se encuentra en estado BORRADOR.',
        DATOS_FACTURACION_INVALIDOS: 'Los datos de facturacion no son validos.',
        DATOS_NUBEFACT_INVALIDOS: 'Los datos guardados no cumplen el contrato requerido por Nubefact.',
        FACTURACION_NO_EDITABLE: 'La facturacion ya fue enviada y no puede modificarse.',
        FACTURACION_FALTANTE: 'Primero debe guardar los datos de facturacion.',
        ORDEN_PAGO_FALTANTE: 'No existe una orden de pago para el certificado.',
        PAGO_INCOMPLETO: 'El pago debe estar completo antes de facturar.',
        VENTA_CREDITO_SIN_SALDO: 'La venta a crédito debe conservar un saldo pendiente.',
        CUOTAS_NO_COINCIDEN_CON_SALDO: 'La suma de las cuotas debe coincidir con el saldo pendiente.',
        NUBEFACT_DESHABILITADO: 'La integracion con Nubefact esta deshabilitada.',
        NUBEFACT_NO_CONFIGURADO: 'Faltan la URL o el token de Nubefact.',
        NUBEFACT_CONFIGURACION_PENDIENTE: 'Falta aplicar la configuracion Nubefact por empresa.',
        NUBEFACT_CORRELATIVOS_V2_DESHABILITADOS: 'El motor seguro de correlativos tributarios no está habilitado.',
        EMPRESA_EMISORA_NO_CONFIGURADA: 'La sede no tiene una empresa emisora Nubefact activa.',
        EMPRESA_EMISORA_RUC_INVALIDO: 'El RUC de la empresa emisora no es valido.',
        NUBEFACT_CREDENCIALES_EMPRESA_FALTANTES: 'Faltan la ruta o el token Nubefact de la empresa emisora.',
        NUBEFACT_RUTA_EMPRESA_INVALIDA: 'La ruta Nubefact de la empresa emisora no es valida.',
        EMISION_EN_PROCESO: 'Ya existe una emision de comprobante en proceso.',
        NUBEFACT_MAX_INTENTOS_ALCANZADO: 'Se alcanzó el máximo de intentos automáticos; requiere revisión de Sistemas.',
        SERIE_PRODUCCION_NO_CONFIRMADA: 'La serie tributaria todavía no fue confirmada para producción.',
        CORRELATIVO_CONCURRENCIA: 'Otro proceso reservó el correlativo; vuelva a intentarlo.',
        SERIE_COMPROBANTE_NO_CONFIGURADA: 'La planta no tiene una serie de comprobantes configurada.',
        SERIE_COMPROBANTE_INVALIDA: 'La serie de comprobantes de la planta es invalida.',
        NUBEFACT_RECHAZADO: 'Nubefact o SUNAT rechazaron el comprobante.',
        NUBEFACT_ERROR: 'No se pudo confirmar la emision del comprobante con Nubefact.'
    };
    if (status >= 500) console.error('[FAREGAS FACTURACION]', error);
    return res.status(status).json({
        ok: false,
        codigo: error.code || error.message || 'ERROR_INTERNO',
        message: messages[error.code || error.message] || 'Error interno del servidor.',
        detalles: error.detalles || undefined
    });
};

exports.preflight = async (req, res) => {
    try {
        const data = await facturacionService.obtenerPreflight(Number(req.params.id), req.user);
        return res.json({ ok: true, data });
    } catch (error) {
        return responderError(res, error);
    }
};

exports.obtener = async (req, res) => {
    try {
        const data = await facturacionService.obtenerFacturacion(Number(req.params.id), req.user);
        return res.json({ ok: true, data });
    } catch (error) {
        return responderError(res, error);
    }
};

exports.guardar = async (req, res) => {
    try {
        const data = await facturacionService.guardarFacturacion(Number(req.params.id), req.body, req.user);
        await auditoriaService.registrarEventoCertificado(auditoriaService.contextoRequest(req, {
            certificado_id: Number(req.params.id),
            categoria: 'FACTURACION',
            evento: 'FACTURACION_GUARDADA',
            entidad: 'fg_facturacion',
            entidad_id: data?.id || null,
            mensaje: 'Se guardaron los datos de facturación del certificado.',
            paso: 'FACTURACION',
            datos: { tipoComprobante: data?.tipo_comprobante || req.body?.tipoComprobante || null }
        }));
        return res.json({ ok: true, data });
    } catch (error) {
        return responderError(res, error);
    }
};

exports.emitir = async (req, res) => {
    try {
        const data = await facturacionService.emitirFacturacion(Number(req.params.id), req.user);
        const facturacion = data?.facturacion || data;
        await auditoriaService.registrarEventoCertificado(auditoriaService.contextoRequest(req, {
            certificado_id: Number(req.params.id),
            categoria: 'FACTURACION',
            evento: 'COMPROBANTE_EMITIDO',
            entidad: 'fg_facturacion',
            entidad_id: facturacion?.id || null,
            mensaje: 'Se procesó la emisión del comprobante electrónico.',
            paso: 'FACTURACION',
            datos: {
                estado: facturacion?.estado || null,
                comprobante: facturacion?.nro_comprobante || null
            }
        }));
        return res.json({ ok: true, data });
    } catch (error) {
        return responderError(res, error);
    }
};
