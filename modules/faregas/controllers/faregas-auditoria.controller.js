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
            modulo: req.query.modulo,
            page: req.query.page,
            pageSize: req.query.pageSize ?? req.query.limite
        };

        const resultado = await faregasAuditoriaService.listarAccesos(filtros);

        // Sobre de paginacion en la raiz. `data` conserva el arreglo para no
        // romper a los consumidores actuales.
        return res.status(200).json({
            status: "success",
            items: resultado.items,
            total: resultado.total,
            page: resultado.page,
            limit: resultado.limit,
            totalPages: resultado.totalPages,
            data: resultado.items
        });
    } catch (error) {
        // Un rango invertido es un error de validacion, no un fallo interno.
        if (error?.codigo === 'RANGO_FECHAS_INVALIDO') {
            return res.status(400).json({ message: error.message, codigo: error.codigo });
        }
        console.error("Error en listarAccesos FAREGAS:", error);
        return res.status(500).json({ message: "Error interno al obtener auditoría." });
    }
};
