const inspeccionesService = require('../services/inspecciones.service');


const buscarInspecciones = async (req, res) => {
  try {
    const {
      plantaKey,
      numeroInspeccion,
      placa,
      comprobante,
      cliente,
      fechaInicio,
      fechaFin,
      estado,
      page = 1,
      pageSize = 10
    } = req.query;

    if (!plantaKey) {
      return res.status(400).json({
        status: 'error',
        message: 'El parámetro plantaKey es obligatorio'
      });
    }

    const result = await inspeccionesService.buscarInspecciones({
      plantaKey,
      numeroInspeccion,
      placa,
      comprobante,
      cliente,
      fechaInicio,
      fechaFin,
      estado,
      page: Number(page),
      pageSize: Number(pageSize)
    });

    return res.json({
      status: 'success',
      plantaKey,
      ...result
    });
  } catch (error) {
    console.error('Error en buscarInspecciones:', error);

    return res.status(500).json({
      status: 'error',
      message: 'Error al buscar inspecciones registradas'
    });
  }
};

const guardarInspeccion = async (req, res) => {
  try {
    const data = req.body;
    console.log("Datos recibidos para guardar la inspección:", data);
    
    // Aquí implementaremos la lógica de guardado en la base de datos
    // INSERT INTO vehiculo ...
    // INSERT INTO inspeccion ...
    
    return res.status(200).json({
      status: 'success',
      message: 'Inspección (y vehículo) guardada correctamente (Función preparada)',
      data: data
    });
  } catch (error) {
    console.error('Error al guardar inspección:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Error al guardar la inspección en la base de datos'
    });
  }
};

module.exports = {
  buscarInspecciones,
  guardarInspeccion
};