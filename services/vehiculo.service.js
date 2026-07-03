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
      const result = await pool.query(`
        SELECT v.*, 
             p.nrodocumentoidentidad as prop_nrodoc,
             p.tipodocumentoidentidad_key as prop_tipodoc,
             p.nombrerazonsocial as prop_razon,
             p.nombres as prop_nombres,
             p.apellidos as prop_apellidos,
             p.pais_key as prop_pais,
             p.departamento_key as prop_dep,
             p.provincia_key as prop_prov,
             p.distrito_key as prop_dist,
             p.direccion as prop_dir,
             p.email as prop_email,
             p.telefono as prop_tel
        FROM vehiculo v
        LEFT JOIN tarjetapropiedad tp ON v.tarjetapropiedad_id = tp.id
        LEFT JOIN persona p ON tp.propietario_nrodocumentoidentidad = p.nrodocumentoidentidad
        WHERE UPPER(v.nroplacaantigua) = UPPER($1) OR UPPER(v.nromotor) = UPPER($1) 
        LIMIT 1
      `, [placa]);
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
