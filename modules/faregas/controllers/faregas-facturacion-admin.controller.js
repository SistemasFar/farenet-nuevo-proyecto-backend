const service = require('../services/faregas-facturacion-admin.service');

const responderError = (res, error) => {
    const mensajes = {
        PLANTA_NO_AUTORIZADA: 'No tiene acceso a la sede solicitada.',
        ESTADO_INVALIDO: 'El estado solicitado no es válido.',
        FECHA_INVALIDA: 'Las fechas deben tener formato AAAA-MM-DD.',
        FACTURACION_NOT_FOUND: 'El comprobante no existe o no pertenece a una sede autorizada.'
    };
    const codigo = error.code || error.message || 'ERROR_INTERNO';
    return res.status(error.statusCode || 500).json({ ok: false, codigo, message: mensajes[codigo] || 'No se pudo consultar la facturación.' });
};

exports.listar = async (req, res) => {
    try {
        const data = await service.listar(req.query || {}, req.user);
        return res.json({ ok: true, data });
    } catch (error) {
        return responderError(res, error);
    }
};

exports.obtenerDetalle = async (req, res) => {
    try {
        const id = Number(req.params.facturacionId);
        if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ ok: false, message: 'Identificador inválido.' });
        const data = await service.obtenerDetalle(id, req.user);
        return res.json({ ok: true, data });
    } catch (error) {
        return responderError(res, error);
    }
};
