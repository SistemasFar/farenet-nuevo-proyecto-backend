const db = require('../config/database');

const listarInspecciones = async (values, conditions, page, pageSize) => {
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

  const countResult = await db.query(countQuery, values);
  const total = Number(countResult.rows[0]?.total || 0);
  const offset = (Number(page) - 1) * Number(pageSize);
  
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
  NULLIF(c.cliente_nrodocumentoidentidad, '-'),
  ''
) AS "clienteDocumento",

COALESCE(
  NULLIF(
    CASE
      WHEN LENGTH(COALESCE(p.nrodocumentoidentidad, '')) = 11 THEN p.nombrerazonsocial
      ELSE CONCAT(COALESCE(p.nombres, ''), ' ', COALESCE(p.apellidos, ''))
    END, 
    ' '
  ),
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
      ) AS "estadoRaw",

      CASE
        WHEN COALESCE(i.inspeccionestado_key, '') = 'ANULADO' OR i.estado = false THEN 'ANULADO'
        WHEN COALESCE(i.inspeccionestado_key, '') IN ('ANU') THEN 'ANULADO'
        ELSE COALESCE(i.inspeccionestado_key, 'PENDIENTE')
      END AS "estado",
      
      COALESCE(i.posicion, 0) AS "posicion",

      CASE COALESCE(i.posicion, 0)
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
      END AS "etapa",

      CASE 
        WHEN (COALESCE(i.posicion, 0) < 4 OR (COALESCE(i.posicion, 0) = 4 AND i.fechaenlinea IS NULL))
             AND COALESCE(i.inspeccionestado_key, '') NOT IN ('ANULADO', 'ANU') 
             AND i.estado = true THEN true
        ELSE false
      END AS "puedeContinuar",

      CASE 
        WHEN (COALESCE(i.posicion, 0) < 4 OR (COALESCE(i.posicion, 0) = 4 AND i.fechaenlinea IS NULL))
             AND COALESCE(i.inspeccionestado_key, '') NOT IN ('ANULADO', 'ANU') 
             AND i.estado = true THEN true
        ELSE false
      END AS "puedeContinuarFlujo1",

      CASE 
        WHEN COALESCE(i.posicion, 0) < 4 
             AND COALESCE(i.inspeccionestado_key, '') NOT IN ('ANULADO', 'ANU') 
             AND i.estado = true THEN true
        ELSE false
      END AS "puedeModificarFlujo1",

      CASE 
        WHEN COALESCE(i.posicion, 0) < 4 
             AND COALESCE(i.inspeccionestado_key, '') NOT IN ('ANULADO', 'ANU') 
             AND i.estado = true THEN true
        ELSE false
      END AS "puedeAnular",

      CASE 
        WHEN COALESCE(i.posicion, 0) = 4 
             AND i.fechaenlinea IS NULL
             AND COALESCE(i.inspeccionestado_key, '') NOT IN ('ANULADO', 'ANU') 
             AND i.estado = true THEN true
        ELSE false
      END AS "puedeFinalizarVerificacion",

      CASE 
        WHEN i.fechaenlinea IS NOT NULL OR COALESCE(i.posicion, 0) > 4 OR COALESCE(i.inspeccionestado_key, '') = 'CON' THEN true
        ELSE false
      END AS "debeAbrirFlujo2",

      CASE
        WHEN i.fechaenlinea IS NOT NULL OR COALESCE(i.posicion, 0) > 4 OR COALESCE(i.inspeccionestado_key, '') = 'CON' THEN 'LINEA_INSPECCION'
        ELSE 'NUEVA_INSPECCION'
      END AS "flujoActual",
      
      TO_CHAR(i.fechaenlinea, 'YYYY-MM-DD HH24:MI:SS') AS "fechaenlinea",

      CASE 
        WHEN COALESCE(i.posicion, 0) BETWEEN 0 AND 3 THEN 'GRIS'
        WHEN COALESCE(i.posicion, 0) BETWEEN 4 AND 7 THEN 'ROJO'
        WHEN COALESCE(i.posicion, 0) BETWEEN 8 AND 11 THEN 'AMARILLO'
        WHEN COALESCE(i.posicion, 0) BETWEEN 12 AND 18 THEN 'VERDE'
        ELSE 'GRIS'
      END AS "colorGrupo",

      CASE 
        WHEN COALESCE(i.posicion, 0) BETWEEN 0 AND 3 THEN (COALESCE(i.posicion, 0) - 0 + 1)
        WHEN COALESCE(i.posicion, 0) BETWEEN 4 AND 7 THEN (COALESCE(i.posicion, 0) - 4 + 1)
        WHEN COALESCE(i.posicion, 0) BETWEEN 8 AND 11 THEN (COALESCE(i.posicion, 0) - 8 + 1)
        WHEN COALESCE(i.posicion, 0) BETWEEN 12 AND 18 THEN (COALESCE(i.posicion, 0) - 12 + 1)
        ELSE 1
      END AS "colorIntensidad",

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

  const dataResult = await db.query(dataQuery, dataValues);

  return { total, data: dataResult.rows };
};

const listarLineas = async (plantaKey) => {
  const query = `
    SELECT l.key, l.nombre
    FROM linea l
    WHERE l.planta_key = $1
    ORDER BY l.nombre ASC
  `;
  const result = await db.query(query, [plantaKey]);
  return result.rows;
};

module.exports = {
  listarInspecciones,
  listarLineas
};
