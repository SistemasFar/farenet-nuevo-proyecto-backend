const descuentosService = require('../services/faregas-descuentos.service');

const MENSAJES = {
    CODIGO_NOT_FOUND: 'El código indicado no existe.', CODIGO_INACTIVO: 'El código está inactivo.',
    CODIGO_VENCIDO: 'El código está fuera de vigencia.', CODIGO_AGOTADO: 'El código ya no tiene usos disponibles.',
    DESCUENTO_INACTIVO: 'La campaña está inactiva.', DESCUENTO_VENCIDO: 'La campaña está fuera de vigencia.',
    DESCUENTO_NO_APLICA_SEDE: 'El descuento no aplica a esta sede.', DESCUENTO_NO_APLICA_SERVICIO: 'El descuento no aplica al servicio seleccionado.',
    DESCUENTO_NO_APLICA_PLACA: 'El descuento no corresponde a la placa del vehículo.',
    DESCUENTO_YA_RESERVADO: 'El certificado ya tiene otro descuento reservado.',
    ORDEN_PAGO_EXISTENTE: 'No se puede cambiar el descuento porque ya existe una orden de pago.',
    DESCUENTO_DUPLICADO: 'Ya existe una campaña con ese código.', CODIGO_CLIENTE_DUPLICADO: 'Ese código ya se encuentra registrado.',
    PLACA_DESCUENTO_REQUERIDA: 'Los descuentos de tipo PLACA requieren una placa autorizada.'
};

const responderError = (res, error) => res.status(error.statusCode || 500).json({
    success: false,
    codigo: error.code || error.message || 'ERROR_INTERNO',
    message: MENSAJES[error.code || error.message] || error.message || 'Error interno del servidor',
    detalles: error.detalles
});

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
        res.json(resultado);
    } catch (error) { responderError(res, error); }
};

exports.quitarDescuentoBorrador = async (req, res, next) => {
    try {
        const { certificadoId } = req.params;
        const resultado = await descuentosService.quitarDescuentoBorrador(certificadoId, req.user);
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
    try { res.status(201).json({ success: true, ...(await descuentosService.crearDescuento(req.body, req.user)) }); }
    catch (error) { responderError(res, error); }
};

exports.actualizarDescuento = async (req, res) => {
    try { res.json({ success: true, ...(await descuentosService.actualizarDescuento(req.params.id, req.body, req.user)) }); }
    catch (error) { responderError(res, error); }
};

exports.cambiarEstadoDescuento = async (req, res) => {
    try { res.json(await descuentosService.cambiarEstadoDescuento(req.params.id, req.body.activo, req.user)); }
    catch (error) { responderError(res, error); }
};

exports.crearCodigo = async (req, res) => {
    try { res.status(201).json({ success: true, ...(await descuentosService.crearCodigoCliente(req.params.id, req.body, req.user)) }); }
    catch (error) { responderError(res, error); }
};

exports.cambiarEstadoCodigo = async (req, res) => {
    try { res.json(await descuentosService.cambiarEstadoCodigo(req.params.id, req.body.activo, req.user)); }
    catch (error) { responderError(res, error); }
};
