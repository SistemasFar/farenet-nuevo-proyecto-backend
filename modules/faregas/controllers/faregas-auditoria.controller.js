const faregasAuditoriaService = require('../services/faregas-auditoria.service');

exports.listarAccesos = async (req, res) => {
    try {
        const filtros = {
            username: req.query.username,
            evento: req.query.evento,
            exitoso: req.query.exitoso,
            fechaInicio: req.query.fechaInicio,
            fechaFin: req.query.fechaFin,
            categoria: req.query.categoria,
            placa: req.query.placa,
            certificadoId: req.query.certificadoId,
            plantaKey: req.query.plantaKey,
            buscar: req.query.buscar,
            modulo: req.query.modulo
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
