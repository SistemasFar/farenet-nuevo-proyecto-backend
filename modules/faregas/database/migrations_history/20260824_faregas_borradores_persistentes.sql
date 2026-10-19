BEGIN;

ALTER TABLE fg_certificado
    ADD COLUMN IF NOT EXISTS paso_actual VARCHAR(40);

UPDATE fg_certificado
SET paso_actual = CASE
    WHEN estado <> 'BORRADOR' THEN 'VERIFICACION_EMISION'
    WHEN EXISTS (
        SELECT 1 FROM fg_facturacion f
        WHERE f.certificado_id = fg_certificado.id
    ) THEN 'VERIFICACION_EMISION'
    WHEN EXISTS (
        SELECT 1 FROM fg_orden_pago op
        WHERE op.certificado_id = fg_certificado.id
          AND op.estado = 'PAGADO'
    ) THEN 'FACTURACION'
    WHEN EXISTS (
        SELECT 1 FROM fg_orden_pago op
        WHERE op.certificado_id = fg_certificado.id
    ) THEN 'PAGO'
    ELSE 'VEHICULO'
END
WHERE paso_actual IS NULL;

ALTER TABLE fg_certificado
    ALTER COLUMN paso_actual SET DEFAULT 'DATOS_INICIALES',
    ALTER COLUMN paso_actual SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'ck_fg_certificado_paso_actual'
          AND conrelid = 'fg_certificado'::regclass
    ) THEN
        ALTER TABLE fg_certificado
            ADD CONSTRAINT ck_fg_certificado_paso_actual
            CHECK (paso_actual IN (
                'DATOS_INICIALES',
                'VEHICULO',
                'PAGO',
                'FACTURACION',
                'VERIFICACION_EMISION'
            ));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS ix_fg_certificado_borradores_panel
    ON fg_certificado (planta_key, estado, fecha_modificacion DESC, id DESC);

COMMIT;
