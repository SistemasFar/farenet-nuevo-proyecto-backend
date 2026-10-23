const facturacionService = require('../services/faregas-facturacion.service');
const auditoriaService = require('../services/faregas-auditoria.service');

const responderError = (res, error) => {
    const erroresChip = new Set([
        'CHIP_REQUERIDO_NO_SELECCIONADO', 'CHIP_TIPO_INVALIDO', 'CHIP_OTRA_SEDE',
        'CHIP_NO_DISPONIBLE', 'CHIP_ASIGNADO_OTRO_CERTIFICADO',
        'CHIP_VENDIDO_SIN_TRAZABILIDAD'
    ]);
    const status = error.statusCode || (erroresChip.has(error.code || error.message) ? 409 : 500);
    const messages = {
        CERTIFICADO_NOT_FOUND: 'El certificado no existe.',
        FACTURACION_NO_ENCONTRADA: 'No existe facturación asociada al comprobante solicitado.',
        IDENTIFICADOR_INVALIDO: 'El identificador solicitado no es válido.',
        PLANTA_NO_AUTORIZADA: 'No tiene acceso a la planta del certificado.',
        CERTIFICADO_NO_EDITABLE: 'El certificado ya no se encuentra en estado BORRADOR.',
        DATOS_FACTURACION_INVALIDOS: 'Los datos de facturacion no son validos.',
        DATOS_NUBEFACT_INVALIDOS: 'Los datos guardados no cumplen el contrato requerido por Nubefact.',
        FACTURACION_NO_EDITABLE: 'La facturacion ya fue enviada y no puede modificarse.',
        FACTURACION_FALTANTE: 'Primero debe guardar los datos de facturacion.',
        CERTIFICADO_NO_VALIDO_PARA_EMISION: 'El certificado tiene datos técnicos pendientes antes de emitir el comprobante.',
        ORDEN_PAGO_FALTANTE: 'No existe una orden de pago para el certificado.',
        PAGO_INCOMPLETO: 'El pago debe estar completo antes de facturar.',
        CHIP_REQUERIDO_NO_SELECCIONADO: 'Seleccione y valide el chip requerido antes de facturar.',
        CHIP_TIPO_INVALIDO: 'El chip seleccionado no corresponde al producto configurado.',
        CHIP_OTRA_SEDE: 'El chip seleccionado ya no pertenece a esta sede.',
        CHIP_NO_DISPONIBLE: 'El chip seleccionado ya no está disponible.',
        CHIP_ASIGNADO_OTRO_CERTIFICADO: 'El chip fue asociado a otro certificado.',
        CHIP_VENDIDO_SIN_TRAZABILIDAD: 'El chip figura vendido sin el movimiento de inventario esperado.',
        VENTA_CREDITO_SIN_SALDO: 'Una venta a crédito debe conservar un saldo pendiente. Cambie la condición a CONTADO o reduzca el pago inicial.',
        CUOTAS_NO_COINCIDEN_CON_SALDO: 'La suma de las cuotas debe coincidir con el saldo pendiente.',
        NUBEFACT_DESHABILITADO: 'La integracion con Nubefact esta deshabilitada.',
        NUBEFACT_NO_CONFIGURADO: 'Faltan la URL o el token de Nubefact.',
        NUBEFACT_CONFIGURACION_PENDIENTE: 'Falta aplicar la configuracion Nubefact por empresa.',
        NUBEFACT_CORRELATIVOS_V2_DESHABILITADOS: 'El motor seguro de correlativos tributarios no está habilitado.',
        NUBEFACT_RECONCILIACION_DESHABILITADA: 'La reconciliación automática debe estar habilitada antes de operar en producción.',
        EMPRESA_EMISORA_NO_CONFIGURADA: 'La sede no tiene una empresa emisora Nubefact activa.',
        EMPRESA_EMISORA_RUC_INVALIDO: 'El RUC de la empresa emisora no es valido.',
        NUBEFACT_CREDENCIALES_EMPRESA_FALTANTES: 'Faltan la ruta o el token Nubefact de la empresa emisora.',
        NUBEFACT_CREDENCIALES_RUC_FALTANTE: 'Declare el RUC al que pertenecen la ruta y el token Nubefact.',
        NUBEFACT_CREDENCIALES_RUC_NO_COINCIDE: 'El RUC de las credenciales Nubefact no coincide con la empresa emisora.',
        NUBEFACT_RUTA_EMPRESA_INVALIDA: 'La ruta Nubefact de la empresa emisora no es valida.',
        NUBEFACT_ENTORNO_INVALIDO: 'El ambiente Nubefact debe ser DEMO o PRODUCCION.',
        ENTORNO_NUBEFACT_INVALIDO: 'El ambiente de la serie Nubefact no es válido.',
        NUBEFACT_PRODUCCION_NO_CONFIRMADA: 'La activación productiva de Nubefact no fue confirmada.',
        NUBEFACT_ENVIO_SUNAT_DESHABILITADO: 'El envío productivo a SUNAT continúa deshabilitado.',
        NUBEFACT_DETRACCION_PENDIENTE_CONFIRMACION: 'La decisión tributaria sobre detracción continúa pendiente.',
        NUBEFACT_DETRACCION_CONFIGURACION_PENDIENTE: 'La detracción aplica, pero sus datos SPOT aún no están implementados.',
        MIGRACION_NUBEFACT_PENDIENTE: 'Falta aplicar la migración tributaria de Nubefact.',
        SERIE_NUBEFACT_NO_EXCLUSIVA: 'La serie no es exclusiva de Nubefact o pertenece a otro ambiente.',
        SERIE_NO_AUTOGENERADA: 'La serie Nubefact no está configurada como autogenerada.',
        EMISION_EN_PROCESO: 'Ya existe una emision de comprobante en proceso.',
        NUBEFACT_MAX_INTENTOS_ALCANZADO: 'Se alcanzó el máximo de intentos automáticos; requiere revisión de Sistemas.',
        SERIE_PRODUCCION_NO_CONFIRMADA: 'La serie tributaria todavía no fue confirmada para producción.',
        CORRELATIVO_CONCURRENCIA: 'Otro proceso reservó el correlativo; vuelva a intentarlo.',
        CORRELATIVO_COMPROBANTE_INVALIDO: 'El correlativo tributario calculado no es válido.',
        SERIE_COMPROBANTE_NO_CONFIGURADA: 'La planta no tiene una serie de comprobantes configurada.',
        SERIE_COMPROBANTE_INVALIDA: 'La serie de comprobantes de la planta es invalida.',
        NUBEFACT_RECHAZADO: 'Nubefact o SUNAT rechazaron el comprobante.',
        REINTENTO_CORRELATIVO_INVALIDO: 'La facturación rechazada no tiene serie y número para reintentar sin reservar otro correlativo.',
        OPERACION_NOT_FOUND: 'La operación no existe.',
        NUBEFACT_ERROR: 'No se pudo confirmar la emision del comprobante con Nubefact.',
        PDF_NUBEFACT_NO_DISPONIBLE: 'El PDF oficial de NubeFact no está disponible.',
        ENLACE_NUBEFACT_INVALIDO: 'El enlace guardado del PDF de NubeFact no es válido.',
        DESCARGA_NUBEFACT_FALLIDA: 'No se pudo descargar el PDF desde NubeFact.',
        PDF_NUBEFACT_INVALIDO: 'NubeFact no devolvió un archivo PDF válido.'
    };
    if (status >= 500) console.error('[FAREGAS FACTURACION]', error);
    const codigo = error.code || error.message || 'ERROR_INTERNO';
    const message = codigo === 'CERTIFICADO_NO_VALIDO_PARA_EMISION' && error.detalles?.mensaje
        ? error.detalles.mensaje
        : messages[codigo] || 'Error interno del servidor.';
    return res.status(status).json({
        ok: false,
        codigo,
        message,
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

exports.obtenerPorOperacion = async (req, res) => {
    try {
        const result = await facturacionService.obtenerFacturacionOperacion(req.params.operacionId, req.user);
        res.json({ success: true, ...result });
    } catch (error) { res.status(error.statusCode || 400).json({ success: false, message: error.message, detalles: error.detalles }); }
};

exports.guardarPorOperacion = async (req, res) => {
    try {
        const facturacion = await facturacionService.guardarFacturacionOperacion(req.params.operacionId, req.body, req.user);
        res.json({ success: true, facturacion });
    } catch (error) { res.status(error.statusCode || 400).json({ success: false, message: error.message, detalles: error.detalles }); }
};

exports.emitirPorOperacion = async (req, res) => {
    try {
        const facturacion = await facturacionService.emitirFacturacionOperacion(req.params.operacionId, req.user);
        res.json({ success: true, facturacion });
    } catch (error) { res.status(error.statusCode || 400).json({ success: false, message: error.message, detalles: error.detalles }); }
};

exports.reintentarPorOperacion = async (req, res) => {
    try {
        const facturacion = await facturacionService.reintentarFacturacionOperacion(req.params.operacionId, req.user);
        res.json({ success: true, facturacion });
    } catch (error) { res.status(error.statusCode || 400).json({ success: false, message: error.message, detalles: error.detalles }); }
};

const comprobanteImpresoService = require('../services/faregas-comprobante-impreso.service');
const descargaNubefactService = require('../services/faregas-descarga-nubefact.service');
const db = require('../../../config/database');
const { validarAccesoPlanta } = require('../services/faregas-auth.service');

const idPositivo = (value) => {
    const id = Number(value);
    if (!Number.isSafeInteger(id) || id <= 0) {
        const error = new Error('IDENTIFICADOR_INVALIDO');
        error.statusCode = 400;
        throw error;
    }
    return id;
};

const autorizarFacturacion = async (facturacionId, user) => {
    const result = await db.query(
        `SELECT f.id, c.planta_key
         FROM fg_facturacion f
         JOIN fg_certificado c ON c.id = f.certificado_id
         WHERE f.id = $1`,
        [idPositivo(facturacionId)]
    );
    if (result.rowCount === 0) {
        const error = new Error('FACTURACION_NO_ENCONTRADA');
        error.statusCode = 404;
        throw error;
    }
    const autorizado = await validarAccesoPlanta(user.username, user.perfil_id, result.rows[0].planta_key);
    if (!autorizado) {
        const error = new Error('PLANTA_NO_AUTORIZADA');
        error.statusCode = 403;
        throw error;
    }
    return result.rows[0];
};

const obtenerFacturacionAutorizadaPorCertificado = async (certificadoId, user) => {
    const result = await db.query(
        `SELECT f.id, f.enlace_pdf, f.tipo_comprobante, f.serie, f.numero
         FROM fg_facturacion f
         JOIN fg_certificado c ON c.id = f.certificado_id
         WHERE f.certificado_id = $1`,
        [idPositivo(certificadoId)]
    );
    if (result.rowCount === 0) {
        const error = new Error('FACTURACION_NO_ENCONTRADA');
        error.statusCode = 404;
        throw error;
    }
    await autorizarFacturacion(result.rows[0].id, user);
    return result.rows[0];
};

exports.descargarPdfFaregas = async (req, res) => {
    try {
        const facturacion = await obtenerFacturacionAutorizadaPorCertificado(req.params.id, req.user);
        const result = await comprobanteImpresoService.generarPdf(facturacion.id);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${result.filename}"`);
        return res.sendFile(result.pdfPath);
    } catch (error) {
        return responderError(res, error);
    }
};

exports.descargarPdfNubefact = async (req, res) => {
    try {
        const facturacion = await obtenerFacturacionAutorizadaPorCertificado(req.params.id, req.user);
        if (!facturacion.enlace_pdf) {
            const error = new Error('PDF_NUBEFACT_NO_DISPONIBLE');
            error.code = 'PDF_NUBEFACT_NO_DISPONIBLE';
            error.statusCode = 404;
            throw error;
        }
        const pdf = await descargaNubefactService.descargarPdfNubefact(facturacion.enlace_pdf);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${descargaNubefactService.nombreArchivoNubefact(facturacion)}"`);
        res.setHeader('Cache-Control', 'private, no-store');
        return res.send(pdf);
    } catch (error) {
        return responderError(res, error);
    }
};

exports.descargarPdfFaregasPorFacturacionId = async (req, res) => {
    try {
        const facturacionId = idPositivo(req.params.facturacionId || req.params.id);
        await autorizarFacturacion(facturacionId, req.user);
        const result = await comprobanteImpresoService.generarPdf(facturacionId);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${result.filename}"`);
        return res.sendFile(result.pdfPath);
    } catch (error) {
        return responderError(res, error);
    }
};

exports.obtenerHtmlFaregas = async (req, res) => {
    try {
        const facturacion = await obtenerFacturacionAutorizadaPorCertificado(req.params.id, req.user);
        const html = await comprobanteImpresoService.generarHtml(facturacion.id);
        if (req.query.format === 'json') {
            return res.json({ ok: true, html });
        }
        res.setHeader('Content-Security-Policy', "default-src 'none'; img-src data:; style-src 'unsafe-inline'");
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.send(html);
    } catch (error) {
        return responderError(res, error);
    }
};

exports.regenerarPdfFaregas = async (req, res) => {
    try {
        const facturacion = await obtenerFacturacionAutorizadaPorCertificado(req.params.id, req.user);
        const result = await comprobanteImpresoService.regenerarRepresentacion(facturacion.id);
        return res.json({ ok: true, data: result });
    } catch (error) {
        return responderError(res, error);
    }
};

exports.regenerarPdfFaregasPorFacturacionId = async (req, res) => {
    try {
        const facturacionId = idPositivo(req.params.facturacionId || req.params.id);
        await autorizarFacturacion(facturacionId, req.user);
        const result = await comprobanteImpresoService.regenerarRepresentacion(facturacionId);
        return res.json({ ok: true, data: result });
    } catch (error) {
        return responderError(res, error);
    }
};
