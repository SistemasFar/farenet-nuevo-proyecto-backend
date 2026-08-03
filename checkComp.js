const pool = require('./config/database');
const query = `
        SELECT c.*, ci.abreviatura, 
               pf.tipodocumentoidentidad_key as pf_tipo, pf.nombrerazonsocial as pf_razon, 
               pf.nombres as pf_nombres, pf.apellidos as pf_apellidos, 
               pf.pais_key as pf_pais, pf.departamento_key as pf_dep, 
               pf.provincia_key as pf_prov, pf.distrito_key as pf_dist, 
               pf.direccion as pf_dir, pf.email as pf_email, pf.telefono as pf_tel
        FROM comprobante c
        LEFT JOIN conceptoinspeccion ci ON c.conceptoinspeccion_key = ci.key
        LEFT JOIN persona pf ON c.cliente_nrodocumentoidentidad = pf.nrodocumentoidentidad
        WHERE c.id = $1 OR c.inspeccion_nrodocumentoinspeccion = $2
        ORDER BY c.fechcreacion DESC LIMIT 1
`;
pool.query(query, [null, 'INS-201-000160316'])
  .then(r => console.log(r.rows))
  .catch(console.error)
  .finally(()=>pool.end());
