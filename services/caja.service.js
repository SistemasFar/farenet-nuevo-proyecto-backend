const pool = require('../config/database');

const guardarCaja = async (dataCaja) => {
  // Lógica para guardar la información de la caja (Paso 1)
  console.log("Guardando datos de caja:", dataCaja);
  // Por ahora, solo retornamos éxito simulado
  return { status: 'success', message: 'Datos de caja procesados' };
};

module.exports = {
  guardarCaja
};
