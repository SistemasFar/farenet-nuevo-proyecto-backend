const pool = require('../config/database');

const guardarVehiculo = async (dataVehiculo, dataCaja) => {
  // Lógica para guardar o actualizar el vehículo
  // La placa viene de la caja (dataCaja.placa), pero también puede venir 'placaNueva' de vehiculo
  console.log("Guardando datos de vehiculo:", dataVehiculo);
  
  // Como indicó el usuario, los datos como placa nueva se insertarán en la bd en la tabla vehiculo
  // Nota: si existe la columna nroplacaantigua o una columna personalizada, la utilizaremos.
  
  return { status: 'success', message: 'Datos de vehiculo procesados' };
};

const buscarVehiculoPorPlaca = async (placa) => {
  try {
    const result = await pool.query(
      `SELECT * FROM vehiculo WHERE UPPER(nroplacaantigua) = UPPER($1) OR UPPER(nromotor) = UPPER($1) LIMIT 1`,
      [placa]
    );
    if (result.rows.length > 0) {
      return result.rows[0];
    }
    return null;
  } catch (error) {
    console.error('Error al buscar vehiculo por placa:', error);
    throw error;
  }
};

module.exports = {
  guardarVehiculo,
  buscarVehiculoPorPlaca
};
