const campanaModel = require('../models/campana_descuento.model');

const obtenerDescuentosYReinspeccion = async (placa, plantaKey, concepto, ruc = null) => {
  const reinspeccion = await campanaModel.verificarReinspeccion(placa, plantaKey, concepto);
  
  if (reinspeccion) {
    return {
      tipo: 'REINSPECCION',
      mensaje: `El vehículo califica para reinspección (Documento anterior: ${reinspeccion.nrodocumentoinspeccion}).`,
      nrodocumentoreinspeccion: reinspeccion.nrodocumentoinspeccion,
      porcentajedescuento: reinspeccion.porcentajedescuento,
      descuentos: [] // No se aplican otras campañas si es reinspección
    };
  }

  const campanas = await campanaModel.buscarDescuentosActivosPorPlaca(placa, plantaKey, concepto, ruc);
  
  const campanasMapped = campanas.map(c => {
    let source_table = 'campania';
    let source_id = c.id;

    if (c.verificaciondescuento_id) {
       source_table = 'verificaciondescuento';
       source_id = c.verificaciondescuento_id;
    }

    return {
      ...c,
      campana: c.nombre,
      source_table,
      source_id
    };
  });
  
  return {
    tipo: 'CAMPANAS',
    mensaje: campanasMapped.length > 0 ? 'Campañas encontradas' : 'No hay descuentos disponibles',
    descuentos: campanasMapped
  };
};

module.exports = {
  obtenerDescuentosYReinspeccion
};
