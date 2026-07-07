const cajaModel = require('../models/caja.model');

const guardarCaja = async (dataCaja) => {
  // Lógica de negocio (Paso 1)
  console.log("Guardando datos de caja:", dataCaja);
  return await cajaModel.guardarCaja(dataCaja);
};

module.exports = {
  guardarCaja
};
