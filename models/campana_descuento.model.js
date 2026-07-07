const pool = require('../config/database');

const buscarDescuentosActivosPorPlaca = async (placa, plantaKey, concepto, ruc = null) => {
  // Lógica de campañas corporativas
  const values = [plantaKey, concepto];
  let extraCondition = "";
  if (ruc) {
    values.push(ruc);
    extraCondition = `AND (emp.nrodocumentoidentidad = $${values.length} OR vd.codigo = $${values.length})`;
  } else {
    // Si no mandan código ni RUC, solo traer campañas que sean públicas (sin restricciones de persona o código)
    extraCondition = `AND ce.persona_id IS NULL AND vd.id IS NULL`;
  }

  const query = `
    SELECT cam.*, vd.id AS verificaciondescuento_id, vd.codigo AS verificaciondescuento_codigo, cd.valordescuento AS monto, ce.persona_id
    FROM campania cam
    INNER JOIN tipodescuento td ON cam.tipodescuento_key = td.key
    INNER JOIN campanias_plantas cp ON cam.id = cp.campania_id
    INNER JOIN planta pl ON cp.planta_key = pl.key
    INNER JOIN campaniadetalle cd ON cam.id = cd.campania_id
    INNER JOIN conceptoinspeccion ci ON cd.conceptoinspeccion_key = ci.key
    LEFT JOIN campanias_personas ce ON cam.id = ce.campania_id
    LEFT JOIN persona emp ON ce.persona_id = emp.nrodocumentoidentidad
    LEFT JOIN verificaciondescuento vd ON cam.id = vd.campania_id
    WHERE pl.key = $1 AND ci.key = $2 AND cam.estado = true 
    AND (vd.id IS NULL OR vd.estado = true)
    ${extraCondition}
  `;
  try {
    const { rows } = await pool.query(query, values);
    return rows;
  } catch (error) {
    console.error("Error buscando descuentos", error);
    return [];
  }
};

const verificarReinspeccion = async (placa, planta, concepto) => {
  // Lógica de reinspecciones.
  // Intentaremos sacar los días de la tabla periodoreinspeccion o usamos 35 por defecto si no existe la config.
  const query = `
    SELECT 
      i.nrodocumentoinspeccion, 
      100 AS porcentajedescuento 
    FROM comprobante c
    JOIN conceptoinspeccion ci ON c.conceptoinspeccion_key = ci.key
    JOIN inspeccion i ON c.id = i.comprobante_id OR c.inspeccion_nrodocumentoinspeccion = i.nrodocumentoinspeccion
    JOIN inspeccionestado ie ON i.inspeccionestado_key = ie.key
    JOIN linea l ON c.linea_key = l.key
    JOIN planta pl ON l.planta_key = pl.key
    WHERE UPPER(c.placamotor) = UPPER($1) 
      AND pl.key = $2 
      AND ci.key = $3
      AND ie.key != 'ANU' 
      AND (i.resultado = 'D' OR i.resultado = '' OR i.resultado IS NULL)
      AND i.fechconsolidado >= NOW() - INTERVAL '35 days'
    ORDER BY i.fechconsolidado DESC
    LIMIT 1
  `;
  try {
    const { rows } = await pool.query(query, [placa, planta, concepto]);
    if (rows.length > 0) {
      return rows[0]; // Retorna { nrodocumentoinspeccion, porcentajedescuento }
    }
    return null;
  } catch (error) {
    console.error("Error verificando reinspección", error);
    return null;
  }
};

module.exports = {
  buscarDescuentosActivosPorPlaca,
  verificarReinspeccion
};
