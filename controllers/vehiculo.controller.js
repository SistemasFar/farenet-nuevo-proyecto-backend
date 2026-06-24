const vehiculoService = require('../services/vehiculo.service');

const buscarPorPlaca = async (req, res) => {
  try {
    const { placa } = req.params;
    if (!placa) {
      return res.status(400).json({ status: 'error', message: 'Placa es requerida' });
    }

    const vehiculo = await vehiculoService.buscarVehiculoPorPlaca(placa);
    if (!vehiculo) {
      return res.status(404).json({ status: 'not_found', message: 'Vehiculo no encontrado' });
    }

    return res.status(200).json({ status: 'success', data: vehiculo });
  } catch (error) {
    console.error('Error en buscarPorPlaca:', error);
    return res.status(500).json({ status: 'error', message: 'Error interno del servidor' });
  }
};

module.exports = {
  buscarPorPlaca
};
