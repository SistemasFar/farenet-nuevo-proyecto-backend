const pool = require('../config/database');

const ESTADOS_PERMITIDOS = ['CON', 'ANULADO', 'RETIRADO'];

const buscarInspecciones = async (filtros) => {
  const {
    plantaKey,
    numeroInspeccion,
    placa,
    comprobante,
    cliente,
    fechaInicio,
    fechaFin,
    estado,
    page,
    pageSize
  } = filtros;

  const limit = Number(pageSize) || 10;
  const currentPage = Number(page) || 1;
  const offset = (currentPage - 1) * limit;

  const params = [];

  let where = `
    WHERE l.planta_key = $1
      AND UPPER(COALESCE(i.inspeccionestado_key, '')) IN ('CON', 'ANULADO', 'RETIRADO')
  `;

  params.push(plantaKey);

  if (estado && estado !== 'TODOS') {
    const estadoNormalizado = estado.toUpperCase();

    if (ESTADOS_PERMITIDOS.includes(estadoNormalizado)) {
      params.push(estadoNormalizado);
      where += ` AND UPPER(COALESCE(i.inspeccionestado_key, '')) = $${params.length}`;
    }
  }

  if (numeroInspeccion) {
    params.push(`%${numeroInspeccion.toUpperCase()}%`);
    where += ` AND UPPER(i.nrodocumentoinspeccion) LIKE $${params.length}`;
  }

  if (placa) {
    params.push(`%${placa.toUpperCase()}%`);
    where += ` AND UPPER(COALESCE(c.placamotor, '')) LIKE $${params.length}`;
  }

  if (comprobante) {
    params.push(`%${comprobante.toUpperCase()}%`);
    where += ` AND UPPER(COALESCE(c.nrocomprobante, '')) LIKE $${params.length}`;
  }

  if (cliente) {
    params.push(`%${cliente.toUpperCase()}%`);
    where += ` AND UPPER(COALESCE(c.cliente_nrodocumentoidentidad, '')) LIKE $${params.length}`;
  }

  if (fechaInicio) {
    params.push(fechaInicio);
    where += ` AND DATE(i.fechcreacion) >= $${params.length}`;
  }

  if (fechaFin) {
    params.push(fechaFin);
    where += ` AND DATE(i.fechcreacion) <= $${params.length}`;
  }

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

  return {
    total,
    page: currentPage,
    pageSize: limit,
    totalPages: Math.ceil(total / limit),
    data: dataResult.rows
  };
};

module.exports = {
  buscarInspecciones
};