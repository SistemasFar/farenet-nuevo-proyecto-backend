const readinessService = require('../services/faregas-nubefact-readiness.service');
const importService = require('../services/faregas-catalogo-fiscal-import.service');

const responderError = (res, error) => res.status(error.statusCode || 500).json({
    success: false,
    code: error.code || error.message || 'ERROR_INTERNO',
    message: error.message || 'No se pudo evaluar la preparación de Nubefact.',
    detalles: error.detalles || undefined
});

exports.obtenerPanel = async (req, res) => {
    try {
        const plantaKey = String(req.query.planta_key || '').trim() || null;
        return res.json({ success: true, data: await readinessService.obtenerPanel({ plantaKey }) });
    } catch (error) {
        return responderError(res, error);
    }
};

exports.previsualizarCatalogo = async (req, res) => {
    try {
        return res.json({ success: true, data: await importService.previsualizar(req.body?.filas) });
    } catch (error) {
        return responderError(res, error);
    }
};

exports.aplicarCatalogo = async (req, res) => {
    try {
        const data = await importService.aplicar(req.body?.filas, {
            confirmar: req.body?.confirmar,
            username: req.user.username,
            ipDireccion: req.ip
        });
        return res.json({ success: true, data, message: 'Vinculaciones fiscales aplicadas correctamente.' });
    } catch (error) {
        return responderError(res, error);
    }
};
