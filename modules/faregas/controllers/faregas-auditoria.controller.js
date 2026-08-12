const faregasAuditoriaService = require('../services/faregas-auditoria.service');
const db = require('../../../config/database');

exports.listarAccesos = async (req, res) => {
    try {
        const filtros = {
            username: req.query.username,
            evento: req.query.evento,
            exitoso: req.query.exitoso,
            fechaInicio: req.query.fechaInicio,
            fechaFin: req.query.fechaFin
        };

        const registros = await faregasAuditoriaService.listarAccesos(filtros);
        
        return res.status(200).json({
            status: "success",
            data: registros
        });
    } catch (error) {
        console.error("Error en listarAccesos FAREGAS:", error);
        return res.status(500).json({ message: "Error interno al obtener auditoría." });
    }
};
