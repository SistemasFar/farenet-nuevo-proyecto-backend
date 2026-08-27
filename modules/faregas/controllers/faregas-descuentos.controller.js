const descuentosService = require('../services/faregas-descuentos.service');
const auditoriaService = require('../services/faregas-auditoria.service');

const MENSAJES = {
    CODIGO_NOT_FOUND: 'El código indicado no existe.', CODIGO_INACTIVO: 'El código está inactivo.',
    CODIGO_VENCIDO: 'El código está fuera de vigencia.', CODIGO_AGOTADO: 'El código ya no tiene usos disponibles.',
    DESCUENTO_INACTIVO: 'La campaña está inactiva.', DESCUENTO_VENCIDO: 'La campaña está fuera de vigencia.',
    DESCUENTO_NO_APLICA_SEDE: 'El descuento no aplica a esta sede.', DESCUENTO_NO_APLICA_SERVICIO: 'El descuento no aplica al servicio seleccionado.',
    DESCUENTO_NO_APLICA_PLACA: 'El descuento no corresponde a la placa del vehículo.',
    DESCUENTO_YA_RESERVADO: 'El certificado ya tiene otro descuento reservado.',
    ORDEN_PAGO_EXISTENTE: 'No se puede cambiar el descuento porque ya existe una orden de pago.',
    DESCUENTO_DUPLICADO: 'No se pudo generar el identificador interno de la campaña.', CODIGO_CLIENTE_DUPLICADO: 'Ese código ya se encuentra registrado.',
    PLACA_DESCUENTO_REQUERIDA: 'Los descuentos de tipo PLACA requieren una placa autorizada.',
    TIPO_CALCULO_INVALIDO: 'El cálculo debe ser FLAT, MONTO o PORCENTAJE.',
    VALOR_DESCUENTO_INVALIDO: 'Indique un valor válido para la regla de descuento.',
    IMPORTE_DESCUENTO_INVALIDO: 'El valor configurado no produce un descuento válido para la tarifa de esa sede.',
    SERVICIOS_DESCUENTO_REQUERIDOS: 'Seleccione al menos un servicio para este descuento.',
    REGLAS_DESCUENTO_REQUERIDAS: 'Configure primero las sedes, servicios y valores del descuento antes de crear códigos.',
    REGLA_DESCUENTO_NO_CONFIGURADA: 'El descuento no tiene una regla válida para esta sede, servicio y forma de pago.',
    EJECUTIVO_NO_REGISTRADO: 'No se pudo registrar el ejecutivo de la alianza.',
    REFERENCIA_DESCUENTO_INVALIDA: 'La sede o uno de los servicios seleccionados no existe o no tiene una tarifa activa.',
    REGLA_DESCUENTO_DUPLICADA: 'No se puede repetir el mismo servicio dentro de una sede.'
};

const responderError = (res, error) => res.status(error.statusCode || 500).json({
    success: false,
    codigo: error.code || error.message || 'ERROR_INTERNO',
    message: MENSAJES[error.code || error.message] || error.message || 'Error interno del servidor',
    detalles: error.detalles
});

const registrarAdministracion = (req, evento, mensaje, entidad, entidadId, datos = {}) =>
    auditoriaService.registrarEvento(auditoriaService.contextoRequest(req, {
        categoria: 'DESCUENTO',
        evento,
        mensaje,
        entidad,
        entidad_id: Number(entidadId) || null,
        datos
    }));

exports.consultarDescuento = async (req, res, next) => {
    try {
        const { codigo, certificadoId } = req.body;
        if (!codigo || !certificadoId) {
            return res.status(400).json({ codigo: 'DATOS_REQUERIDOS', message: 'Debe indicar el código y el certificado.' });
        }
        const resultado = await descuentosService.consultarDescuento(codigo, certificadoId, req.user);
        res.json(resultado);
    } catch (error) { responderError(res, error); }
};

exports.aplicarDescuentoBorrador = async (req, res, next) => {
    try {
        const { certificadoId } = req.params;
        const { codigo } = req.body;
        if (!codigo || !certificadoId) {
            return res.status(400).json({ codigo: 'DATOS_REQUERIDOS', message: 'Debe indicar el código y el certificado.' });
        }
        const resultado = await descuentosService.aplicarDescuentoBorrador(certificadoId, codigo, req.user);
        await auditoriaService.registrarEventoCertificado(auditoriaService.contextoRequest(req, {
            certificado_id: Number(certificadoId),
            categoria: 'DESCUENTO',
            evento: 'DESCUENTO_APLICADO',
            entidad: 'fg_descuentocomprobante',
            mensaje: 'Se aplicó un descuento al borrador.',
            datos: {
                tipoCalculo: resultado?.tipoCalculo || resultado?.tipo_calculo || null,
                importeDescuento: resultado?.importeDescuento || resultado?.importe_descuento || null
            }
        }));
        res.json(resultado);
    } catch (error) { responderError(res, error); }
};

exports.quitarDescuentoBorrador = async (req, res, next) => {
    try {
        const { certificadoId } = req.params;
        const resultado = await descuentosService.quitarDescuentoBorrador(certificadoId, req.user);
        await auditoriaService.registrarEventoCertificado(auditoriaService.contextoRequest(req, {
            certificado_id: Number(certificadoId),
            categoria: 'DESCUENTO',
            evento: 'DESCUENTO_QUITADO',
            entidad: 'fg_descuentocomprobante',
            mensaje: 'Se retiró el descuento reservado del borrador.'
        }));
        res.json(resultado);
    } catch (error) { responderError(res, error); }
};

exports.obtenerDescuentoBorrador = async (req, res, next) => {
    try {
        const { certificadoId } = req.params;
        const resultado = await descuentosService.obtenerDescuentoBorrador(certificadoId, req.user);
        if (!resultado) {
            return res.status(204).send();
        }
        res.json(resultado);
    } catch (error) { responderError(res, error); }
};

exports.listarDescuentos = async (req, res) => {
    try { res.json({ success: true, descuentos: await descuentosService.listarDescuentos(req.query) }); }
    catch (error) { responderError(res, error); }
};

exports.obtenerMaestros = async (_req, res) => {
    try { res.json({ success: true, ...(await descuentosService.obtenerMaestrosAdministracion()) }); }
    catch (error) { responderError(res, error); }
};

exports.obtenerDetalle = async (req, res) => {
    try { res.json({ success: true, ...(await descuentosService.obtenerDetalleAdministracion(req.params.id)) }); }
    catch (error) { responderError(res, error); }
};

exports.crearDescuento = async (req, res) => {
    try {
        const resultado = await descuentosService.crearDescuento(req.body, req.user);
        await registrarAdministracion(req, 'DESCUENTO_CREADO', 'Creó un nuevo descuento.',
            'fg_descuento', resultado.id, { nombre: req.body.nombre, tipo: req.body.tipo });
        res.status(201).json({ success: true, ...resultado });
    }
    catch (error) { responderError(res, error); }
};

exports.actualizarDescuento = async (req, res) => {
    try {
        const resultado = await descuentosService.actualizarDescuento(req.params.id, req.body, req.user);
        await registrarAdministracion(req, 'DESCUENTO_ACTUALIZADO', 'Actualizó los datos generales de un descuento.',
            'fg_descuento', req.params.id, { nombre: req.body.nombre, tipo: req.body.tipo });
        res.json({ success: true, ...resultado });
    }
    catch (error) { responderError(res, error); }
};

exports.cambiarEstadoDescuento = async (req, res) => {
    try {
        const resultado = await descuentosService.cambiarEstadoDescuento(req.params.id, req.body.activo, req.user);
        await registrarAdministracion(req, 'DESCUENTO_ESTADO_ACTUALIZADO',
            `${req.body.activo ? 'Activó' : 'Desactivó'} un descuento.`,
            'fg_descuento', req.params.id, { activo: Boolean(req.body.activo) });
        res.json(resultado);
    }
    catch (error) { responderError(res, error); }
};

exports.guardarReglasDescuento = async (req, res) => {
    try {
        const resultado = await descuentosService.guardarReglasDescuento(req.params.id, req.body, req.user);
        await registrarAdministracion(req, 'REGLAS_DESCUENTO_GUARDADAS',
            'Guardó el alcance y beneficio de un descuento.', 'fg_descuento', req.params.id,
            { cantidadReglas: Array.isArray(req.body.reglas) ? req.body.reglas.length : 0 });
        res.json(resultado);
    }
    catch (error) { responderError(res, error); }
};

exports.crearCodigo = async (req, res) => {
    try {
        const resultado = await descuentosService.crearCodigoCliente(req.params.id, req.body, req.user);
        await registrarAdministracion(req, 'CODIGO_DESCUENTO_CREADO',
            `Creó el código de descuento ${String(req.body.codigo || '').trim().toUpperCase()}.`,
            'fg_descuentocliente', resultado.id,
            { descuentoId: Number(req.params.id), codigo: String(req.body.codigo || '').trim().toUpperCase() });
        res.status(201).json({ success: true, ...resultado });
    }
    catch (error) { responderError(res, error); }
};

exports.actualizarCodigo = async (req, res) => {
    try {
        const resultado = await descuentosService.actualizarCodigoCliente(req.params.id, req.body, req.user);
        await registrarAdministracion(req, 'CODIGO_DESCUENTO_ACTUALIZADO',
            `Actualizó el código de descuento ${String(req.body.codigo || '').trim().toUpperCase()}.`,
            'fg_descuentocliente', req.params.id,
            { codigo: String(req.body.codigo || '').trim().toUpperCase() });
        res.json(resultado);
    }
    catch (error) { responderError(res, error); }
};

exports.cambiarEstadoCodigo = async (req, res) => {
    try {
        const resultado = await descuentosService.cambiarEstadoCodigo(req.params.id, req.body.activo, req.user);
        await registrarAdministracion(req, 'CODIGO_DESCUENTO_ESTADO',
            `${req.body.activo ? 'Activó' : 'Desactivó'} un código de descuento.`,
            'fg_descuentocliente', req.params.id, { activo: Boolean(req.body.activo) });
        res.json(resultado);
    }
    catch (error) { responderError(res, error); }
};
