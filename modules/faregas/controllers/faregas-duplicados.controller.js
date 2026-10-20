const fs = require('fs');
const duplicadosService = require('../services/faregas-duplicados.service');
const certificadoPdfService = require('../services/faregas-certificado-pdf.service');
const comprobanteImpresoService = require('../services/faregas-comprobante-impreso.service');

const MENSAJES = {
    PLACA_INVALIDA: 'Ingrese una placa válida.',
    FECHA_HISTORIAL_INVALIDA: 'Ingrese fechas válidas para consultar el historial.',
    RANGO_FECHAS_INVALIDO: 'La fecha Desde no puede ser posterior a la fecha Hasta.',
    TIPO_CERTIFICADO_INVALIDO: 'El tipo de certificado seleccionado no es válido.',
    CERTIFICADO_NOT_FOUND: 'El certificado no existe.',
    CERTIFICADO_NO_ES_ULTIMO: 'Sólo puede solicitarse el duplicado del último certificado emitido de ese tipo.',
    CERTIFICADO_NO_DUPLICABLE: 'El certificado está anulado o superó un año desde su emisión.',
    CERTIFICADO_SIN_CONTENIDO: 'No se encontró la representación original del certificado.',
    DUPLICADO_NOT_FOUND: 'La solicitud de duplicado no existe.',
    DUPLICADO_ANULADO: 'La solicitud de duplicado está anulada.',
    DUPLICADO_NO_DISPONIBLE: 'El duplicado estará disponible después de emitir correctamente el comprobante.',
    COMPROBANTE_NO_DISPONIBLE: 'El comprobante del duplicado aún no está disponible.',
    DUPLICADO_SOLO_CONTADO: 'El duplicado sólo admite pago al contado.',
    PRECIO_DUPLICADO_INVALIDO: 'El precio configurado del duplicado no es válido.',
    DATOS_FACTURACION_INVALIDOS: 'Revise los datos requeridos para el comprobante.',
    PAGO_INCOMPLETO: 'Debe registrar el pago completo de S/ 50.00.',
    DATOS_TARJETA_INCOMPLETOS: 'Complete la tarjeta y el número de operación.',
    MODALIDAD_TARJETA_REQUERIDA: 'Seleccione si la tarjeta es de débito o crédito.',
    DATOS_BANCO_INCOMPLETOS: 'Complete la operación y la fecha del depósito bancario.',
    CUENTA_BANCARIA_INVALIDA: 'Sólo puede usarse la cuenta bancaria autorizada de FAREGAS.',
    NUBEFACT_RECHAZADO: 'NubeFact rechazó el comprobante. La solicitud quedó guardada para revisión o reintento.',
    NUBEFACT_ERROR: 'No se pudo confirmar el comprobante con NubeFact. La solicitud quedó guardada para reintento.',
    PLANTA_NO_AUTORIZADA: 'No tiene acceso a la sede del certificado.',
    PLANTA_REQUERIDA: 'Seleccione una sede antes de continuar.'
};

const responderError = (res, error) => {
    const codigo = error.code || error.message || 'ERROR_INTERNO';
    const status = Number(error.statusCode) || 500;
    if (status >= 500) console.error('[FAREGAS DUPLICADOS]', error);
    const detalleFacturacion = codigo === 'DATOS_FACTURACION_INVALIDOS' && Array.isArray(error.detalles)
        ? error.detalles.join(' ')
        : null;
    return res.status(status).json({
        ok: false,
        codigo,
        message: detalleFacturacion || MENSAJES[codigo] || error.message || 'No se pudo procesar el duplicado.',
        detalles: error.detalles || undefined
    });
};

exports.listarTipos = async (req, res) => {
    try {
        return res.json({ ok: true, data: await duplicadosService.listarTipos(req.user) });
    } catch (error) { return responderError(res, error); }
};

exports.buscar = async (req, res) => {
    try {
        const data = await duplicadosService.buscar({ placa: req.query.placa, tipo: req.query.tipo }, req.user);
        return res.json({ ok: true, data });
    } catch (error) { return responderError(res, error); }
};

exports.listarHistorial = async (req, res) => {
    try {
        const filtros = { desde: req.query.desde, hasta: req.query.hasta, pagina: req.query.pagina };
        return res.json({ ok: true, data: await duplicadosService.listarHistorial(filtros, req.user) });
    } catch (error) { return responderError(res, error); }
};

exports.crear = async (req, res) => {
    try {
        const data = await duplicadosService.crearSolicitud(Number(req.body.certificadoId), req.user);
        return res.status(201).json({ ok: true, data });
    } catch (error) { return responderError(res, error); }
};

exports.obtener = async (req, res) => {
    try {
        return res.json({ ok: true, data: await duplicadosService.obtener(req.params.id, req.user) });
    } catch (error) { return responderError(res, error); }
};

exports.procesar = async (req, res) => {
    try {
        const data = await duplicadosService.procesar(req.params.id, req.body, req.user);
        return res.json({ ok: true, data });
    } catch (error) { return responderError(res, error); }
};

exports.verVista = async (req, res) => {
    try {
        const data = await duplicadosService.obtenerVista(req.params.id, req.user);
        return res.json({ ok: true, data });
    } catch (error) { return responderError(res, error); }
};

exports.descargarPdf = async (req, res) => {
    let temporal = null;
    try {
        const documento = await duplicadosService.obtenerDocumento(req.params.id, req.user);
        temporal = await certificadoPdfService.generarPdfTemporal({
            html: documento.html,
            certificadoId: req.params.id,
            numeroCertificado: documento.filename.replace(/\.pdf$/i, '')
        });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${documento.filename}"`);
        res.setHeader('Cache-Control', 'private, no-store');
        return res.sendFile(temporal.pdfPath, (error) => {
            temporal?.limpiar();
            if (error) console.error('[FAREGAS DUPLICADO PDF SEND]', error.message);
        });
    } catch (error) {
        temporal?.limpiar();
        return responderError(res, error);
    }
};

exports.descargarComprobante = async (req, res) => {
    try {
        const { facturacionId } = await duplicadosService.obtenerFacturacionParaDescarga(req.params.id, req.user);
        const documento = await comprobanteImpresoService.generarPdf(facturacionId);
        if (!fs.existsSync(documento.pdfPath)) {
            const error = new Error('COMPROBANTE_NO_DISPONIBLE');
            error.statusCode = 404;
            throw error;
        }
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${documento.filename}"`);
        res.setHeader('Cache-Control', 'private, no-store');
        return res.sendFile(documento.pdfPath);
    } catch (error) { return responderError(res, error); }
};

exports._private = { responderError };
