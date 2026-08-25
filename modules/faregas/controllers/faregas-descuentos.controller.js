const descuentosService = require('../services/faregas-descuentos.service');

exports.consultarDescuento = async (req, res, next) => {
    try {
        const { codigo, certificadoId } = req.body;
        if (!codigo || !certificadoId) {
            return res.status(400).json({ error: 'Faltan parámetros requeridos (codigo, certificadoId)' });
        }
        const resultado = await descuentosService.consultarDescuento(codigo, certificadoId, req.user);
        res.json(resultado);
    } catch (error) {
        next(error);
    }
};

exports.aplicarDescuentoBorrador = async (req, res, next) => {
    try {
        const { certificadoId } = req.params;
        const { codigo } = req.body;
        if (!codigo || !certificadoId) {
            return res.status(400).json({ error: 'Faltan parámetros requeridos' });
        }
        const resultado = await descuentosService.aplicarDescuentoBorrador(certificadoId, codigo, req.user);
        res.json(resultado);
    } catch (error) {
        next(error);
    }
};

exports.quitarDescuentoBorrador = async (req, res, next) => {
    try {
        const { certificadoId } = req.params;
        const resultado = await descuentosService.quitarDescuentoBorrador(certificadoId, req.user);
        res.json(resultado);
    } catch (error) {
        next(error);
    }
};

exports.obtenerDescuentoBorrador = async (req, res, next) => {
    try {
        const { certificadoId } = req.params;
        const resultado = await descuentosService.obtenerDescuentoBorrador(certificadoId, req.user);
        if (!resultado) {
            return res.status(204).send();
        }
        res.json(resultado);
    } catch (error) {
        next(error);
    }
};
