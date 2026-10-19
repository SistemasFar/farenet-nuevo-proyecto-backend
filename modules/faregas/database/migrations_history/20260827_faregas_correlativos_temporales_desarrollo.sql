-- FAREGAS / DESARROLLO: rangos provisionales para las certificaciones que
-- actualmente tienen sede, servicio y tarifa activos.
--
-- Es idempotente: conserva cualquier rango activo creado manualmente y solo
-- cubre combinaciones que aun no tienen uno. Los bloques son de 100 numeros y
-- no se superponen entre sedes/modalidades que comparten el mismo prefijo.

WITH combinaciones_operativas AS (
    SELECT DISTINCT
        ta.planta_key,
        t.clave AS tipo_certificado_clave,
        CASE WHEN t.clave = 'CONFORMIDAD' THEN 'UNICA' ELSE s.modalidad END AS modalidad
    FROM fg_tarifa ta
    JOIN fg_planta p
      ON p.key = ta.planta_key
     AND p.activo = TRUE
    JOIN fg_servicio s
      ON s.id = ta.servicio_id
     AND s.activo = TRUE
     AND s.tipo_flujo = 'CERTIFICACION'
    JOIN fg_tipo_certificado t
      ON t.clave = s.tipo_certificado_clave
     AND t.activo = TRUE
    WHERE ta.activo = TRUE
      AND (t.clave = 'CONFORMIDAD' OR s.modalidad IN ('INICIAL', 'ANUAL'))
),
faltantes AS (
    SELECT co.*
    FROM combinaciones_operativas co
    WHERE NOT EXISTS (
        SELECT 1
        FROM fg_correlativo_certificado c
        WHERE c.planta_key = co.planta_key
          AND c.tipo_certificado_clave = co.tipo_certificado_clave
          AND c.modalidad = co.modalidad
          AND c.activo = TRUE
    )
),
bases AS (
    SELECT
        tipo_certificado_clave,
        ((GREATEST(COALESCE(MAX(nro_maximo), 0), 99999) / 100) + 1) * 100 AS primer_numero
    FROM fg_correlativo_certificado
    GROUP BY tipo_certificado_clave
),
tipos_faltantes AS (
    SELECT DISTINCT tipo_certificado_clave FROM faltantes
),
bases_completas AS (
    SELECT
        tf.tipo_certificado_clave,
        COALESCE(b.primer_numero, 100000) AS primer_numero
    FROM tipos_faltantes tf
    LEFT JOIN bases b USING (tipo_certificado_clave)
),
numerados AS (
    SELECT
        f.*,
        bc.primer_numero,
        ROW_NUMBER() OVER (
            PARTITION BY f.tipo_certificado_clave
            ORDER BY f.planta_key, f.modalidad
        ) - 1 AS bloque
    FROM faltantes f
    JOIN bases_completas bc USING (tipo_certificado_clave)
)
INSERT INTO fg_correlativo_certificado (
    planta_key,
    tipo_certificado_clave,
    modalidad,
    nro_inicio,
    nro_actual,
    nro_maximo,
    activo,
    fecha_cierre
)
SELECT
    planta_key,
    tipo_certificado_clave,
    modalidad,
    primer_numero + (bloque * 100),
    primer_numero + (bloque * 100) - 1,
    primer_numero + (bloque * 100) + 99,
    TRUE,
    NULL
FROM numerados;

COMMENT ON TABLE fg_correlativo_certificado IS
    'Rangos de numeracion de certificados FAREGAS por sede, tipo y modalidad. Los rangos 100000+ son provisionales de desarrollo.';
