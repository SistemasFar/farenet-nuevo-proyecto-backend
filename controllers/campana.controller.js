const campanaService = require('../services/campana.service');
const pool = require('../config/database');

const obtenerDescuentosYReinspeccion = async (req, res) => {
  try {
    const { placa, plantaKey, concepto, ruc } = req.body;
    console.log(`=== VALIDAR DESCUENTOS === placa: ${placa}, plantaKey: ${plantaKey}, concepto: ${concepto}, ruc: ${ruc}`);
    
    if (!placa || !plantaKey || !concepto) {
      return res.status(400).json({ status: 'error', message: 'Faltan parámetros requeridos (placa, plantaKey, concepto)' });
    }

    const resultado = await campanaService.obtenerDescuentosYReinspeccion(placa, plantaKey, concepto, ruc);
    console.log('Resultado de obtenerDescuentosYReinspeccion:', JSON.stringify(resultado));
    return res.status(200).json({ status: 'success', data: resultado });
  } catch (error) {
    console.error("Error en obtenerDescuentosYReinspeccion:", error);
    return res.status(500).json({ status: 'error', message: 'Error interno del servidor' });
  }
};

const consumirDescuento = async (req, res) => {
  try {
    const { source_table, source_id } = req.body;
    
    if (!source_table || !source_id) {
      return res.status(400).json({ status: 'error', message: 'Faltan parámetros (source_table, source_id)' });
    }

    // Aquí actualizaríamos el estado en la tabla de cuponidad, si existiera.
    // Como es genérico por ahora:
    if (source_table === 'verificaciondescuento') {
      await pool.query('UPDATE verificaciondescuento SET estado = false WHERE id = $1', [source_id]);
    }
    
    return res.status(200).json({ status: 'success', message: 'Descuento consumido' });
  } catch (error) {
    console.error("Error consumiendo descuento:", error);
    return res.status(500).json({ status: 'error', message: 'Error al consumir el descuento' });
  }
}

module.exports = {
  obtenerDescuentosYReinspeccion,
  consumirDescuento
};
