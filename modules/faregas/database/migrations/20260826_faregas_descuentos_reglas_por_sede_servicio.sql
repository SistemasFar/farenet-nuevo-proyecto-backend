BEGIN;

-- Debe ejecutarse después de 20260826_faregas_descuentos_reglas_por_codigo.sql.

ALTER TABLE fg_descuentodetalle
    ADD COLUMN IF NOT EXISTS planta_key VARCHAR NULL,
    ADD COLUMN IF NOT EXISTS valor_contado NUMERIC(14,2) NULL,
    ADD COLUMN IF NOT EXISTS valor_credito NUMERIC(14,2) NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_fg_descuentodetalle_planta'
    ) THEN
        ALTER TABLE fg_descuentodetalle
            ADD CONSTRAINT fk_fg_descuentodetalle_planta
            FOREIGN KEY (planta_key) REFERENCES fg_planta(key)
            ON UPDATE CASCADE ON DELETE RESTRICT;
    END IF;
END $$;

DROP INDEX IF EXISTS uq_fg_descuentodetalle_codigo_servicio;
ALTER TABLE fg_descuentodetalle
    DROP CONSTRAINT IF EXISTS chk_fg_descuentodetalle_tipo_calculo,
    DROP CONSTRAINT IF EXISTS chk_fg_descuentodetalle_porcentaje;

-- Los códigos que ya tenían una sede heredan su regla en cada servicio.
UPDATE fg_descuentodetalle dd
SET planta_key = dc.planta_key,
    tipo_calculo = dc.tipo_calculo,
    valor_contado = dc.valor_contado,
    valor_credito = dc.valor_credito
FROM fg_descuentocliente dc
WHERE dc.id = dd.descuento_cliente_id
  AND dd.descuento_cliente_id IS NOT NULL
  AND dd.planta_key IS NULL
  AND dc.planta_key IS NOT NULL;

-- La antigua opción "todas las sedes" se expande solamente a las sedes que
-- actualmente poseen una tarifa activa para ese servicio.
INSERT INTO fg_descuentodetalle (
    descuento_id,
    descuento_cliente_id,
    servicio_id,
    planta_key,
    tipo_calculo,
    valor_contado,
    valor_credito,
    activo,
    usuario_creacion,
    fecha_creacion
)
SELECT
    dd.descuento_id,
    dd.descuento_cliente_id,
    dd.servicio_id,
    t.planta_key,
    dc.tipo_calculo,
    dc.valor_contado,
    dc.valor_credito,
    dd.activo,
    dd.usuario_creacion,
    CURRENT_TIMESTAMP
FROM fg_descuentodetalle dd
JOIN fg_descuentocliente dc ON dc.id=dd.descuento_cliente_id
JOIN fg_tarifa t
  ON t.servicio_id=dd.servicio_id
 AND t.activo=TRUE
JOIN fg_planta p
  ON p.key=t.planta_key
 AND p.activo=TRUE
WHERE dd.descuento_cliente_id IS NOT NULL
  AND dd.planta_key IS NULL
  AND NOT EXISTS (
      SELECT 1
      FROM fg_descuentodetalle existente
      WHERE existente.descuento_cliente_id=dd.descuento_cliente_id
        AND existente.planta_key=t.planta_key
        AND existente.servicio_id=dd.servicio_id
  );

DELETE FROM fg_descuentodetalle
WHERE descuento_cliente_id IS NOT NULL
  AND planta_key IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_fg_descuentodetalle_codigo_sede_servicio
    ON fg_descuentodetalle(descuento_cliente_id, planta_key, servicio_id)
    WHERE descuento_cliente_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_fg_descuentodetalle_planta_servicio
    ON fg_descuentodetalle(planta_key, servicio_id);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_fg_descuentodetalle_regla_codigo'
    ) THEN
        ALTER TABLE fg_descuentodetalle
            ADD CONSTRAINT chk_fg_descuentodetalle_regla_codigo
            CHECK (
                descuento_cliente_id IS NULL
                OR (
                    planta_key IS NOT NULL
                    AND tipo_calculo IN ('FLAT', 'MONTO', 'PORCENTAJE')
                    AND (valor_contado IS NOT NULL OR valor_credito IS NOT NULL)
                    AND (valor_contado IS NULL OR valor_contado > 0)
                    AND (valor_credito IS NULL OR valor_credito > 0)
                    AND (
                        tipo_calculo <> 'PORCENTAJE'
                        OR (
                            (valor_contado IS NULL OR valor_contado <= 100)
                            AND (valor_credito IS NULL OR valor_credito <= 100)
                        )
                    )
                )
            );
    END IF;
END $$;

COMMIT;
