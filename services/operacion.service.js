const db = require('../config/database');

const listarInspecciones = async ({
  plantaKey,
  fechaInicio,
  fechaFin,
  placa,
  estado,
  numeroInspeccion,
  cliente,
  lineaKey,
  page = 1,
  pageSize = 5
}) => {
  const values = [];
  const conditions = [];

  values.push(plantaKey);
  conditions.push(`(l.planta_key = $${values.length} OR SPLIT_PART(i.nrodocumentoinspeccion, '-', 2) = $${values.length})`);
  conditions.push(`DATE(i.fechcreacion) = CURRENT_DATE`);

  if (lineaKey && lineaKey.trim() !== '' && lineaKey.trim().toUpperCase() !== 'TODOS') {
    values.push(lineaKey.trim());
    conditions.push(`l.key = $${values.length}`);
  }

  if (placa && placa.trim() !== '') {
    values.push(`%${placa.trim().toUpperCase()}%`);
    conditions.push(`
      UPPER(COALESCE(c.placamotor, ''))
      LIKE $${values.length}
    `);
  }

  if (cliente && cliente.trim() !== '') {
    values.push(`%${cliente.trim().toUpperCase()}%`);

    conditions.push(`
    (
      UPPER(COALESCE(c.placamotor, '')) LIKE $${values.length}
      OR UPPER(COALESCE(c.cliente_nrodocumentoidentidad, '')) LIKE $${values.length}
      OR UPPER(COALESCE(p.nombres, '')) LIKE $${values.length}
      OR UPPER(COALESCE(p.apellidos, '')) LIKE $${values.length}
      OR UPPER(COALESCE(p.nombrerazonsocial, '')) LIKE $${values.length}
      OR UPPER(
        TRIM(
          COALESCE(p.nombres, '') || ' ' || COALESCE(p.apellidos, '')
        )
      ) LIKE $${values.length}
    )
  `);
  }


  if (estado && estado.trim() !== '') {
    const estadoNormalizado =
      estado.trim().toUpperCase() === 'EN_PROCESO'
        ? 'PROCESO'
        : estado.trim().toUpperCase();

    values.push(estadoNormalizado);

    conditions.push(`
      UPPER(
        COALESCE(
          i.inspeccionestado_key,
          ''
        )
      ) = $${values.length}
    `);
  } else {
    conditions.push(`
    UPPER(
      COALESCE(
        i.inspeccionestado_key,
        ''
      )
    ) = 'PROCESO'
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

LEFT JOIN persona p
  ON p.nrodocumentoidentidad = c.cliente_nrodocumentoidentidad

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
  c.cliente_nrodocumentoidentidad,
  ''
) AS "clienteDocumento",

COALESCE(
  CASE
    WHEN LENGTH(COALESCE(p.nrodocumentoidentidad, '')) = 11
      THEN p.nombrerazonsocial
    ELSE CONCAT(
      COALESCE(p.nombres, ''),
      ' ',
      COALESCE(p.apellidos, '')
    )
  END,
  ''
) AS "clienteNombre",
   
COALESCE(
  ci.abreviatura,
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
       i.posicion AS "posicion",

CASE i.posicion
  WHEN 0 THEN 'CAJA'
  WHEN 1 THEN 'PAGO'
  WHEN 2 THEN 'VEHICULO'
  WHEN 3 THEN 'CLIENTE'
  WHEN 4 THEN 'VERIFICACION'
  WHEN 5 THEN 'GASES'
  WHEN 6 THEN 'OPACIDAD'
  WHEN 7 THEN 'LUCES'
  WHEN 8 THEN 'INSPECCION VISUAL'
  WHEN 9 THEN 'SONOMETRO'
  WHEN 10 THEN 'PROFUNDIMETRO'
  WHEN 11 THEN 'FRENOMETRO'
  WHEN 12 THEN 'ALINEACION'
  WHEN 13 THEN 'SUSPENSION'
  WHEN 14 THEN 'CONSOLIDACION'
  WHEN 15 THEN 'FOTO'
  WHEN 16 THEN 'FOTO'
  WHEN 17 THEN 'SERVICIO'
  WHEN 18 THEN 'DUPLICADO'
  ELSE 'SIN ESTADO'
END AS "estadoActual",

      

      COALESCE(
        cert.nrodocumentocertificado,
        ''
      ) AS "numeroCertificado",

    CASE
  WHEN UPPER(COALESCE(i.inspeccionestado_key, '')) = 'CON'
    THEN COALESCE(i.resultado, 'PENDIENTE')
  ELSE 'PENDIENTE'
END AS "resultado",

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
      LEFT JOIN persona p
  ON p.nrodocumentoidentidad = c.cliente_nrodocumentoidentidad

    LEFT JOIN certificado cert
      ON cert.inspeccion_nrodocumentoinspeccion =
         i.nrodocumentoinspeccion

    ${whereClause}

    ORDER BY
  COALESCE(i.posicion, 0) DESC,
  i.fechcreacion DESC

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

const listarLineas = async (plantaKey) => {
  const query = `
    SELECT l.key, l.nombre
    FROM linea l
    LEFT JOIN linea_estado le ON l.key = le.linea_key AND l.planta_key = le.planta_key
    WHERE l.planta_key = $1 AND COALESCE(le.estado, true) = true
    ORDER BY l.nombre ASC
  `;
  const result = await db.query(query, [plantaKey]);
  return result.rows;
};

module.exports = {
  listarInspecciones,
  listarLineas
};