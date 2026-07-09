const pool = require('../config/database');

const buscarInspecciones = async (filtros, params, where, limit, offset) => {
  const baseFrom = `
    FROM inspeccion i
    LEFT JOIN LATERAL (
      SELECT c1.*
      FROM comprobante c1
      WHERE c1.inspeccion_nrodocumentoinspeccion = i.nrodocumentoinspeccion
         OR c1.id = i.comprobante_id
      ORDER BY c1.id DESC
      LIMIT 1
    ) c ON true
    LEFT JOIN linea l ON c.linea_key = l.key
    LEFT JOIN conceptoinspeccion ci ON c.conceptoinspeccion_key = ci.key
    LEFT JOIN certificado cert ON cert.inspeccion_nrodocumentoinspeccion = i.nrodocumentoinspeccion
  `;

  const countSql = `
    SELECT COUNT(*)::int AS total
    ${baseFrom}
    ${where}
  `;

  const dataSql = `
    SELECT
      i.nrodocumentoinspeccion AS "numeroInspeccion",
      TO_CHAR(i.fechcreacion, 'YYYY-MM-DD HH24:MI:SS') AS "fechaHora",
      COALESCE(c.placamotor, '-') AS "placa",
      COALESCE(c.nrocomprobante, '-') AS "comprobante",
      COALESCE(c.cliente_nrodocumentoidentidad, '-') AS "cliente",
      COALESCE(ci.nombre, '-') AS "conceptoVehicular",
      COALESCE(l.nombre, '-') AS "linea",
      COALESCE(i.inspeccionestado_key, '-') AS "estado",
      COALESCE(cert.nrodocumentocertificado, '-') AS "numeroCertificado",
      COALESCE(i.resultado, '-') AS "resultado",
      CASE
        WHEN cert.nrodocumentocertificado IS NULL THEN '-'
        WHEN cert.anulado = true THEN 'ANULADO'
        WHEN cert.estado = true THEN 'ACTIVO'
        WHEN cert.estado = false THEN 'INACTIVO'
        ELSE '-'
      END AS "estadoCertificado"
    ${baseFrom}
    ${where}
    ORDER BY i.fechcreacion DESC
    LIMIT $${params.length + 1}
    OFFSET $${params.length + 2}
  `;

  const countResult = await pool.query(countSql, params);
  const total = countResult.rows[0]?.total || 0;

  const dataResult = await pool.query(dataSql, [
    ...params,
    limit,
    offset
  ]);

  return { total, data: dataResult.rows };
};

const consultarVehiculoRapido = async (placa) => {
  const vehRes = await pool.query(`
    SELECT v.categoria_key FROM vehiculo v
    LEFT JOIN tarjetapropiedad tp ON v.tarjetapropiedad_id = tp.id
    WHERE v.nromotor = $1 OR v.nroplacaantigua = $1 OR tp.nroplaca = $1
    LIMIT 1
  `, [placa]);
  return vehRes.rows.length > 0 ? vehRes.rows[0] : null;
};

const verificarPlacaDuplicada = async (placa, concepto) => {
  const duplicadoRes = await pool.query(`
    SELECT pl.nombre as nombre_sede
    FROM inspeccion i
    JOIN comprobante c ON c.inspeccion_nrodocumentoinspeccion = i.nrodocumentoinspeccion
    LEFT JOIN planta pl ON pl.key = SPLIT_PART(i.nrodocumentoinspeccion, '-', 2)
    WHERE c.placamotor = $1 
      AND c.conceptoinspeccion_key = $2 
      AND DATE(i.fechcreacion) = CURRENT_DATE
      AND UPPER(COALESCE(i.inspeccionestado_key, '')) NOT IN ('ANULADO', 'RETIRADO', 'ANU')
    LIMIT 1
  `, [placa, concepto]);
  return duplicadoRes.rows.length > 0 ? duplicadoRes.rows[0] : null;
};

module.exports = {
  buscarInspecciones,
  consultarVehiculoRapido,
  verificarPlacaDuplicada
};
