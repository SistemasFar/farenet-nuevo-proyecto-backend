-- 20260915_faregas_certificado_snapshot_comercial.sql

BEGIN;

ALTER TABLE fg_certificado
ADD COLUMN IF NOT EXISTS producto_facturacion_certificado_id BIGINT NULL,
ADD COLUMN IF NOT EXISTS precio_certificado NUMERIC(10, 2) NULL,
ADD COLUMN IF NOT EXISTS producto_chip_id BIGINT NULL,
ADD COLUMN IF NOT EXISTS producto_facturacion_chip_id BIGINT NULL,
ADD COLUMN IF NOT EXISTS precio_chip NUMERIC(10, 2) NULL,
ADD COLUMN IF NOT EXISTS importe_total NUMERIC(10, 2) NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_fg_certificado_producto_facturacion'
          AND conrelid = 'fg_certificado'::regclass
    ) THEN
        ALTER TABLE fg_certificado
        ADD CONSTRAINT fk_fg_certificado_producto_facturacion
        FOREIGN KEY (producto_facturacion_certificado_id)
        REFERENCES fg_producto_facturacion(id) ON DELETE RESTRICT;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_fg_certificado_producto_chip'
          AND conrelid = 'fg_certificado'::regclass
    ) THEN
        ALTER TABLE fg_certificado
        ADD CONSTRAINT fk_fg_certificado_producto_chip
        FOREIGN KEY (producto_chip_id)
        REFERENCES fg_producto_inventariable(id) ON DELETE RESTRICT;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_fg_certificado_producto_facturacion_chip'
          AND conrelid = 'fg_certificado'::regclass
    ) THEN
        ALTER TABLE fg_certificado
        ADD CONSTRAINT fk_fg_certificado_producto_facturacion_chip
        FOREIGN KEY (producto_facturacion_chip_id)
        REFERENCES fg_producto_facturacion(id) ON DELETE RESTRICT;
    END IF;
END $$;

COMMIT;
