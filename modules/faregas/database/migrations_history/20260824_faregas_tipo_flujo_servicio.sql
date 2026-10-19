BEGIN;

ALTER TABLE fg_servicio
    ADD COLUMN IF NOT EXISTS tipo_flujo VARCHAR(30);

UPDATE fg_servicio
SET tipo_flujo = 'CERTIFICACION'
WHERE tipo_flujo IS NULL
  AND codigo IN (
      'GLP_ANUAL',
      'GLP_INICIAL',
      'GLP_ANUAL_MOTO',
      'GNV_ANUAL',
      'GNV_ANUAL_PESADO',
      'GNV_INICIAL',
      'CONFORMIDAD_LIVIANO',
      'CONFORMIDAD_PESADO'
  );

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM fg_servicio WHERE tipo_flujo IS NULL) THEN
        RAISE EXCEPTION 'Existen servicios Faregas sin tipo de flujo; se cancela la migración.';
    END IF;
END $$;

ALTER TABLE fg_servicio
    ALTER COLUMN tipo_flujo SET NOT NULL;

-- Las tarifas de servicios complementarios no tienen certificado base. La
-- columna se conserva para compatibilidad con las certificaciones actuales,
-- pero debe aceptar NULL para el flujo complementario futuro.
ALTER TABLE fg_tarifa
    ALTER COLUMN tipo_certificado_clave DROP NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'ck_fg_servicio_tipo_flujo'
          AND conrelid = 'fg_servicio'::regclass
    ) THEN
        ALTER TABLE fg_servicio
            ADD CONSTRAINT ck_fg_servicio_tipo_flujo
            CHECK (tipo_flujo IN ('CERTIFICACION', 'SERVICIO_COMPLEMENTARIO'));
    END IF;
END $$;

COMMIT;
