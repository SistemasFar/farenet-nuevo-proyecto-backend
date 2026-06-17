const pool = require('../config/database');

const guardarPago = async (dataPago) => {
  // Lógica para procesar los pagos agregados
  console.log("Guardando datos de pago:", dataPago);
  return { status: 'success', message: 'Datos de pago procesados' };
};

module.exports = {
  guardarPago
};
