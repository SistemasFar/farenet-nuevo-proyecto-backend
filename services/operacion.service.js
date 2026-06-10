const db = require('../config/database');

const listarInspecciones = async ({
  plantaKey,
  fechaInicio,
  fechaFin,
  placa,
  estado,
  numeroInspeccion,
  page = 1,
  pageSize = 5
}) => {
  const values = [];
  const conditions = [];

  values.push(plantaKey);
  conditions.push(`l.planta_key = $${values.length}`);

  if (fechaInicio) {
    values.push(fechaInicio);
    conditions.push(`DATE(i.fechcreacion) >= $${values.length}`);
  }

  if (fechaFin) {
    values.push(fechaFin);
    conditions.push(`DATE(i.fechcreacion) <= $${values.length}`);
  }

  if (placa && placa.trim() !== '') {
    values.push(`%${placa.trim().toUpperCase()}%`);
    conditions.push(`
      UPPER(COALESCE(c.placamotor, ''))
      LIKE $${values.length}
    `);
  }

  if (estado && estado.trim() !== '') {
    values.push(estado.trim().toUpperCase());

    conditions.push(`
      UPPER(
        COALESCE(
          i.inspeccionestado_key,
          ''
        )
      ) = $${values.length}
    `);
  }

  if (
    numeroInspeccion &&
    numeroInspeccion.trim() !== ''
  ) {
    values.push(
      `%${numeroInspeccion.trim().toUpperCase()}%`
    );

    conditions.push(`
      UPPER(i.nrodocumentoinspeccion)
      LIKE $${values.length}
    `);
  }

  const whereClause =
    conditions.length > 0
      ? `WHERE ${conditions.join(' AND ')}`
      : '';

  const countQuery = `
    SELECT COUNT(*) AS total

    FROM inspeccion i

    LEFT JOIN LATERAL (
      SELECT c2.*
      FROM comprobante c2
      WHERE c2.id = i.comprobante_id
         OR c2.inspeccion_nrodocumentoinspeccion = i.nrodocumentoinspeccion
      ORDER BY
        CASE
          WHEN c2.id = i.comprobante_id THEN 0
          ELSE 1
        END,
        c2.fechcreacion DESC
      LIMIT 1
    ) c ON TRUE

    LEFT JOIN linea l
      ON l.key = c.linea_key

    ${whereClause}
  `;

  const countResult = await db.query(
    countQuery,
    values
  );

  const total = Number(
    countResult.rows[0]?.total || 0
  );

  const offset =
    (Number(page) - 1) * Number(pageSize);

  const dataValues = [...values];

  dataValues.push(Number(pageSize));
  const limitPosition = dataValues.length;

  dataValues.push(offset);
  const offsetPosition = dataValues.length;

  const dataQuery = `
    SELECT
      i.nrodocumentoinspeccion AS "numeroInspeccion",

      TO_CHAR(
        i.fechcreacion,
        'YYYY-MM-DD HH24:MI:SS'
      ) AS "fechaHora",

      COALESCE(
        c.placamotor,
        ''
      ) AS "placa",

      COALESCE(
        c.nrocomprobante,
        ''
      ) AS "comprobante",

      COALESCE(
        ci.nombre,
        ''
      ) AS "conceptoVehicular",

      COALESCE(
        l.nombre,
        ''
      ) AS "linea",

      COALESCE(
        i.inspeccionestado_key,
        CASE
          WHEN i.estado = false
            THEN 'ANULADO'
          ELSE 'PENDIENTE'
        END
      ) AS "estado",

      COALESCE(
        cert.nrodocumentocertificado,
        ''
      ) AS "numeroCertificado",

      COALESCE(
        i.resultado,
        'PENDIENTE'
      ) AS "resultado",

      CASE
        WHEN cert.nrodocumentocertificado IS NULL
          THEN 'PENDIENTE'

        WHEN cert.anulado = true
          THEN 'ANULADO'

        WHEN cert.estado = false
          THEN 'INACTIVO'

        WHEN i.fechvencimiento IS NOT NULL
         AND i.fechvencimiento < NOW()
          THEN 'VENCIDO'

        ELSE 'VIGENTE'
      END AS "estadoCertificado"

    FROM inspeccion i

    LEFT JOIN LATERAL (
      SELECT c2.*
      FROM comprobante c2
      WHERE c2.id = i.comprobante_id
         OR c2.inspeccion_nrodocumentoinspeccion = i.nrodocumentoinspeccion
      ORDER BY
        CASE
          WHEN c2.id = i.comprobante_id THEN 0
          ELSE 1
        END,
        c2.fechcreacion DESC
      LIMIT 1
    ) c ON TRUE

    LEFT JOIN linea l
      ON l.key = c.linea_key

    LEFT JOIN conceptoinspeccion ci
      ON ci.key = c.conceptoinspeccion_key

    LEFT JOIN certificado cert
      ON cert.inspeccion_nrodocumentoinspeccion =
         i.nrodocumentoinspeccion

    ${whereClause}

    ORDER BY i.fechcreacion DESC

    LIMIT $${limitPosition}
    OFFSET $${offsetPosition}
  `;

  const dataResult = await db.query(
    dataQuery,
    dataValues
  );

  return {
    total,
    page: Number(page),
    pageSize: Number(pageSize),
    totalPages: Math.ceil(
      total / Number(pageSize)
    ),
    data: dataResult.rows
  };
};

module.exports = {
  listarInspecciones
};