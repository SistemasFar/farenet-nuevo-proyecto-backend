const pool = require('../config/database');

const buscarVehiculoPorPlaca = async (placa) => {
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
  return result.rows.length > 0 ? result.rows[0] : null;
};

module.exports = {
  buscarVehiculoPorPlaca
};
