BEGIN;

ALTER TABLE fg_producto_facturacion
ADD COLUMN IF NOT EXISTS requiere_chip BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS producto_chip_id BIGINT NULL;

-- Conserva asociaciones creadas por una ejecución parcial anterior y deja
-- coherentes los registros antes de formalizar la restricción.
UPDATE fg_producto_facturacion
SET requiere_chip = (producto_chip_id IS NOT NULL)
WHERE requiere_chip IS DISTINCT FROM (producto_chip_id IS NOT NULL);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'fk_fg_producto_facturacion_chip'
          AND conrelid = 'fg_producto_facturacion'::regclass
    ) THEN
        ALTER TABLE fg_producto_facturacion
        ADD CONSTRAINT fk_fg_producto_facturacion_chip
        FOREIGN KEY (producto_chip_id) REFERENCES fg_producto_inventariable(id) ON DELETE RESTRICT;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'ck_fg_producto_facturacion_chip'
          AND conrelid = 'fg_producto_facturacion'::regclass
    ) THEN
        ALTER TABLE fg_producto_facturacion
        ADD CONSTRAINT ck_fg_producto_facturacion_chip
        CHECK (
            (requiere_chip = TRUE AND producto_chip_id IS NOT NULL) OR
            (requiere_chip = FALSE AND producto_chip_id IS NULL)
        );
    END IF;
END $$;

COMMIT;
