BEGIN;

-- La campaña (fg_descuento) conserva la identidad, empresa y vigencia.
-- La regla comercial pasa al código de aplicación (fg_descuentocliente).
ALTER TABLE fg_descuento
    ALTER COLUMN tipo_calculo DROP NOT NULL,
    ALTER COLUMN valor DROP NOT NULL;

ALTER TABLE fg_descuentocliente
    ADD COLUMN IF NOT EXISTS planta_key VARCHAR NULL,
    ADD COLUMN IF NOT EXISTS tipo_calculo VARCHAR NULL,
    ADD COLUMN IF NOT EXISTS valor_contado NUMERIC(14,2) NULL,
    ADD COLUMN IF NOT EXISTS valor_credito NUMERIC(14,2) NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_fg_descuentocliente_planta'
    ) THEN
        ALTER TABLE fg_descuentocliente
            ADD CONSTRAINT fk_fg_descuentocliente_planta
            FOREIGN KEY (planta_key) REFERENCES fg_planta(key)
            ON UPDATE CASCADE ON DELETE RESTRICT;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_fg_descuentocliente_tipo_calculo'
    ) THEN
        ALTER TABLE fg_descuentocliente
            ADD CONSTRAINT chk_fg_descuentocliente_tipo_calculo
            CHECK (tipo_calculo IS NULL OR tipo_calculo IN ('FLAT', 'MONTO', 'PORCENTAJE'));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_fg_descuentocliente_valores'
    ) THEN
        ALTER TABLE fg_descuentocliente
            ADD CONSTRAINT chk_fg_descuentocliente_valores
            CHECK (
                (valor_contado IS NULL OR valor_contado > 0)
                AND (valor_credito IS NULL OR valor_credito > 0)
                AND (
                    tipo_calculo <> 'PORCENTAJE'
                    OR (
                        (valor_contado IS NULL OR valor_contado <= 100)
                        AND (valor_credito IS NULL OR valor_credito <= 100)
                    )
                )
            );
    END IF;
END $$;

ALTER TABLE fg_descuentodetalle
    ADD COLUMN IF NOT EXISTS descuento_cliente_id BIGINT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_fg_descuentodetalle_codigo'
    ) THEN
        ALTER TABLE fg_descuentodetalle
            ADD CONSTRAINT fk_fg_descuentodetalle_codigo
            FOREIGN KEY (descuento_cliente_id) REFERENCES fg_descuentocliente(id)
            ON UPDATE CASCADE ON DELETE CASCADE;
    END IF;
END $$;

ALTER TABLE fg_descuentodetalle
    DROP CONSTRAINT IF EXISTS uq_fg_descuentodetalle_serv;

CREATE UNIQUE INDEX IF NOT EXISTS uq_fg_descuentodetalle_codigo_servicio
    ON fg_descuentodetalle(descuento_cliente_id, servicio_id)
    WHERE descuento_cliente_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_fg_descuentocliente_planta
    ON fg_descuentocliente(planta_key);

CREATE INDEX IF NOT EXISTS idx_fg_descuentodetalle_codigo
    ON fg_descuentodetalle(descuento_cliente_id);

-- Compatibilidad: cada código existente hereda la regla y sede que antes
-- estaban guardadas en la campaña.
UPDATE fg_descuentocliente dc
SET planta_key = COALESCE(dc.planta_key, d.planta_key),
    tipo_calculo = COALESCE(dc.tipo_calculo, d.tipo_calculo),
    valor_contado = COALESCE(dc.valor_contado, d.valor),
    valor_credito = COALESCE(dc.valor_credito, d.valor)
FROM fg_descuento d
WHERE d.id = dc.descuento_id
  AND (
      dc.tipo_calculo IS NULL
      OR dc.valor_contado IS NULL
      OR dc.valor_credito IS NULL
  );

-- Compatibilidad: los servicios generales existentes se copian a cada código.
INSERT INTO fg_descuentodetalle (
    descuento_id,
    descuento_cliente_id,
    servicio_id,
    activo,
    usuario_creacion,
    fecha_creacion
)
SELECT
    dc.descuento_id,
    dc.id,
    dd.servicio_id,
    dd.activo,
    COALESCE(dc.usuario_creacion, dd.usuario_creacion),
    CURRENT_TIMESTAMP
FROM fg_descuentocliente dc
JOIN fg_descuentodetalle dd
  ON dd.descuento_id = dc.descuento_id
 AND dd.descuento_cliente_id IS NULL
WHERE NOT EXISTS (
    SELECT 1
    FROM fg_descuentodetalle existente
    WHERE existente.descuento_cliente_id = dc.id
      AND existente.servicio_id = dd.servicio_id
);

COMMIT;
