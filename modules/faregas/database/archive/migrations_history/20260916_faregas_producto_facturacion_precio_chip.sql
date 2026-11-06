BEGIN;

ALTER TABLE fg_producto_facturacion
ADD COLUMN IF NOT EXISTS precio_chip NUMERIC(12, 2) NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'ck_fg_producto_facturacion_precio_chip'
          AND conrelid = 'fg_producto_facturacion'::regclass
    ) THEN
        ALTER TABLE fg_producto_facturacion
        ADD CONSTRAINT ck_fg_producto_facturacion_precio_chip
        CHECK (precio_chip IS NULL OR precio_chip >= 0);
    END IF;
END $$;

COMMIT;
