BEGIN;

-- Las reglas comerciales pertenecen al descuento/campaña. Los códigos quedan
-- como credenciales de canje y reutilizan la misma regla sede-servicio.
ALTER TABLE fg_descuentodetalle
    ADD COLUMN IF NOT EXISTS planta_key VARCHAR NULL,
    ADD COLUMN IF NOT EXISTS descuento_cliente_id BIGINT NULL,
    ADD COLUMN IF NOT EXISTS valor_contado NUMERIC(14,2) NULL,
    ADD COLUMN IF NOT EXISTS valor_credito NUMERIC(14,2) NULL;

-- Respaldo recuperable de la estructura anterior. Se crea una sola vez.
CREATE TABLE IF NOT EXISTS fg_descuentodetalle_backup_20260826_reglas_compartidas
    AS TABLE fg_descuentodetalle WITH NO DATA;
INSERT INTO fg_descuentodetalle_backup_20260826_reglas_compartidas
SELECT original.*
FROM fg_descuentodetalle original
WHERE NOT EXISTS (SELECT 1 FROM fg_descuentodetalle_backup_20260826_reglas_compartidas);

CREATE TEMP TABLE fg_reglas_compartidas_tmp ON COMMIT DROP AS
WITH candidatas AS (
    SELECT
        dd.descuento_id,
        dd.planta_key,
        dd.servicio_id,
        COALESCE(dd.tipo_calculo, dc.tipo_calculo) AS tipo_calculo,
        CASE
            WHEN COALESCE(dd.tipo_calculo, dc.tipo_calculo) IN ('MONTO', 'PORCENTAJE')
            THEN COALESCE(dd.valor, dd.valor_contado, dd.valor_credito,
                          dc.valor_contado, dc.valor_credito)
            ELSE NULL
        END AS valor,
        CASE WHEN COALESCE(dd.tipo_calculo, dc.tipo_calculo) = 'FLAT'
             THEN COALESCE(dd.valor_contado, dc.valor_contado) END AS valor_contado,
        CASE WHEN COALESCE(dd.tipo_calculo, dc.tipo_calculo) = 'FLAT'
             THEN COALESCE(dd.valor_credito, dc.valor_credito) END AS valor_credito,
        COALESCE(dd.usuario_modificacion, dd.usuario_creacion, dc.usuario_creacion) AS usuario,
        COALESCE(dd.fecha_modificacion, dd.fecha_creacion, dc.fecha_creacion) AS fecha,
        CASE WHEN dd.descuento_cliente_id IS NULL THEN 2 ELSE 1 END AS prioridad
    FROM fg_descuentodetalle dd
    LEFT JOIN fg_descuentocliente dc ON dc.id=dd.descuento_cliente_id
    WHERE dd.activo=TRUE
      AND dd.planta_key IS NOT NULL
      AND COALESCE(dd.tipo_calculo, dc.tipo_calculo) IN ('FLAT', 'MONTO', 'PORCENTAJE')
), validas AS (
    SELECT * FROM candidatas
    WHERE (tipo_calculo='FLAT' AND valor IS NULL
           AND (valor_contado IS NOT NULL OR valor_credito IS NOT NULL))
       OR (tipo_calculo IN ('MONTO', 'PORCENTAJE') AND valor IS NOT NULL)
)
SELECT DISTINCT ON (descuento_id, planta_key, servicio_id)
       descuento_id, planta_key, servicio_id, tipo_calculo,
       valor, valor_contado, valor_credito, usuario
FROM validas
-- Ante reglas históricas contradictorias entre códigos de una misma campaña,
-- conserva la configuración más antigua (la original) y deja el respaldo para auditoría.
ORDER BY descuento_id, planta_key, servicio_id, prioridad DESC, fecha ASC NULLS LAST;

DELETE FROM fg_descuentodetalle;

DROP INDEX IF EXISTS uq_fg_descuentodetalle_codigo_servicio;
DROP INDEX IF EXISTS uq_fg_descuentodetalle_codigo_sede_servicio;
DROP INDEX IF EXISTS uq_fg_descuentodetalle_descuento_sede_servicio;
ALTER TABLE fg_descuentodetalle
    DROP CONSTRAINT IF EXISTS uq_fg_descuentodetalle_serv,
    DROP CONSTRAINT IF EXISTS chk_fg_descuentodetalle_regla_codigo,
    DROP CONSTRAINT IF EXISTS chk_fg_descuentodetalle_regla_compartida,
    DROP CONSTRAINT IF EXISTS chk_fg_descuentodetalle_tipo_calculo,
    DROP CONSTRAINT IF EXISTS chk_fg_descuentodetalle_porcentaje;

INSERT INTO fg_descuentodetalle
    (descuento_id, descuento_cliente_id, planta_key, servicio_id,
     tipo_calculo, valor, valor_contado, valor_credito,
     activo, usuario_creacion, fecha_creacion)
SELECT descuento_id, NULL, planta_key, servicio_id,
       tipo_calculo, valor, valor_contado, valor_credito,
       TRUE, usuario, CURRENT_TIMESTAMP
FROM fg_reglas_compartidas_tmp;

CREATE UNIQUE INDEX uq_fg_descuentodetalle_descuento_sede_servicio
    ON fg_descuentodetalle(descuento_id, planta_key, servicio_id)
    WHERE descuento_cliente_id IS NULL;

ALTER TABLE fg_descuentodetalle
    ADD CONSTRAINT chk_fg_descuentodetalle_regla_compartida CHECK (
        descuento_cliente_id IS NOT NULL
        OR (
            planta_key IS NOT NULL
            AND tipo_calculo IN ('FLAT', 'MONTO', 'PORCENTAJE')
            AND (
                (tipo_calculo='FLAT' AND valor IS NULL
                 AND (valor_contado IS NOT NULL OR valor_credito IS NOT NULL)
                 AND (valor_contado IS NULL OR valor_contado > 0)
                 AND (valor_credito IS NULL OR valor_credito > 0))
                OR
                (tipo_calculo='MONTO' AND valor > 0
                 AND valor_contado IS NULL AND valor_credito IS NULL)
                OR
                (tipo_calculo='PORCENTAJE' AND valor > 0 AND valor <= 100
                 AND valor_contado IS NULL AND valor_credito IS NULL)
            )
        )
    );

COMMIT;
