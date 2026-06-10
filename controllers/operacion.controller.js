const operacionService = require('../services/operacion.service');

const listarInspecciones = async (req, res) => {
  try {
    const {
      plantaKey,
      fechaInicio,
      fechaFin,
      placa,
      estado,
      numeroInspeccion,
      page,
      pageSize
    } = req.query;

    if (!plantaKey || String(plantaKey).trim() === '') {
      return res.status(400).json({
        status: 'error',
        message: 'El parámetro plantaKey es obligatorio'
      });
    }

    const hoy = new Date().toISOString().split('T')[0];

    const fechaInicioConsulta =
      fechaInicio && String(fechaInicio).trim() !== ''
        ? String(fechaInicio).trim()
        : hoy;

    const fechaFinConsulta =
      fechaFin && String(fechaFin).trim() !== ''
        ? String(fechaFin).trim()
        : hoy;

    const fechaRegex = /^\d{4}-\d{2}-\d{2}$/;

    if (!fechaRegex.test(fechaInicioConsulta)) {
      return res.status(400).json({
        status: 'error',
        message:
          'El parámetro fechaInicio debe tener formato YYYY-MM-DD'
      });
    }

    if (!fechaRegex.test(fechaFinConsulta)) {
      return res.status(400).json({
        status: 'error',
        message:
          'El parámetro fechaFin debe tener formato YYYY-MM-DD'
      });
    }

    const pageNumber =
      page && !isNaN(Number(page))
        ? Number(page)
        : 1;

    const pageSizeNumber =
      pageSize && !isNaN(Number(pageSize))
        ? Number(pageSize)
        : 5;

    const resultado =
      await operacionService.listarInspecciones({
        plantaKey: String(plantaKey).trim(),
        fechaInicio: fechaInicioConsulta,
        fechaFin: fechaFinConsulta,
        placa: placa
          ? String(placa).trim()
          : undefined,
        estado: estado
          ? String(estado).trim()
          : undefined,
        numeroInspeccion: numeroInspeccion
          ? String(numeroInspeccion).trim()
          : undefined,
        page: pageNumber,
        pageSize: pageSizeNumber
      });

    return res.status(200).json({
      status: 'success',
      plantaKey: String(plantaKey).trim(),

      fechaInicio: fechaInicioConsulta,
      fechaFin: fechaFinConsulta,

      total: resultado.total,
      page: resultado.page,
      pageSize: resultado.pageSize,
      totalPages: resultado.totalPages,

      data: resultado.data
    });

  } catch (error) {
    console.error(
      '❌ Error en listarInspecciones:',
      error
    );

    return res.status(500).json({
      status: 'error',
      message:
        'Error interno al listar inspecciones',
      detail:
        process.env.NODE_ENV === 'development'
          ? error.message
          : undefined
    });
  }
};

module.exports = {
  listarInspecciones
};