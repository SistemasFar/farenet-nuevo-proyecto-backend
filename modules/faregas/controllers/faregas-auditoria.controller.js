const faregasAuditoriaService = require('../services/faregas-auditoria.service');

exports.listarAccesos = async (req, res) => {
    try {
        const filtros = {
            username: req.query.username,
            evento: req.query.evento,
            exitoso: req.query.exitoso,
            resultado: req.query.resultado,
            fechaInicio: req.query.fechaInicio ?? req.query.desde,
            fechaFin: req.query.fechaFin ?? req.query.hasta,
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
        if (error?.codigo === 'RANGO_FECHAS_INVALIDO') {
            return res.status(400).json({ message: error.message, codigo: error.codigo });
        }
        console.error("Error en listarAccesos FAREGAS:", error);
        return res.status(500).json({ message: "Error interno al obtener auditoría." });
    }
};

exports.exportarAuditoria = async (req, res) => {
    try {
        const filtros = {
            username: req.query.username,
            evento: req.query.evento,
            exitoso: req.query.exitoso,
            resultado: req.query.resultado,
            fechaInicio: req.query.fechaInicio ?? req.query.desde,
            fechaFin: req.query.fechaFin ?? req.query.hasta,
            categoria: req.query.categoria,
            placa: req.query.placa,
            certificadoId: req.query.certificadoId,
            plantaKey: req.query.plantaKey,
            buscar: req.query.buscar,
            modulo: req.query.modulo
        };

        const csvData = await faregasAuditoriaService.exportarAuditoriaCsv(filtros, req.user || {});

        const modName = (filtros.modulo || 'TODOS').replace(/[^a-zA-Z0-9_-]/g, '');
        const filename = `Auditoria_FAREGAS_${modName}_${filtros.fechaInicio || 'hoy'}_a_${filtros.fechaFin || 'hoy'}.csv`;

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        return res.status(200).send(csvData);
    } catch (error) {
        if (error?.codigo === 'RANGO_FECHAS_INVALIDO') {
            return res.status(400).json({ message: error.message, codigo: error.codigo });
        }
        console.error("Error al exportar auditoría FAREGAS:", error);
        return res.status(500).json({ message: "Error interno al generar exportación de auditoría." });
    }
};
