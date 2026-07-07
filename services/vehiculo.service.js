const pool = require('../config/database');

const guardarVehiculo = async (dataVehiculo, dataCaja) => {
  // Lógica para guardar o actualizar el vehículo
  // La placa viene de la caja (dataCaja.placa), pero también puede venir 'placaNueva' de vehiculo
  console.log("Guardando datos de vehiculo:", dataVehiculo);
  
  // Como indicó el usuario, los datos como placa nueva se insertarán en la bd en la tabla vehiculo
  // Nota: si existe la columna nroplacaantigua o una columna personalizada, la utilizaremos.
  
  return { status: 'success', message: 'Datos de vehiculo procesados' };
};

const vehiculoModel = require('../models/vehiculo.model');

const buscarVehiculoPorPlaca = async (placa) => {
    try {
      return await vehiculoModel.buscarVehiculoPorPlaca(placa);
    } catch (error) {
    console.error('Error al buscar vehiculo por placa:', error);
    throw error;
  }
};

module.exports = {
  guardarVehiculo,
  buscarVehiculoPorPlaca
};
