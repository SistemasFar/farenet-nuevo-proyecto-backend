BEGIN;

ALTER TABLE fg_producto_inventariable
    ADD COLUMN IF NOT EXISTS tipo VARCHAR(100);

UPDATE fg_producto_inventariable
SET tipo = 'CHIP_SERIALIZADO',
    fecha_modificacion = CURRENT_TIMESTAMP
WHERE codigo = 'CHIP'
  AND tipo IS NULL;

ALTER TABLE fg_producto_inventariable
    ALTER COLUMN tipo SET DEFAULT 'OTRO_PRODUCTO_FISICO';

UPDATE fg_producto_inventariable
SET tipo = 'OTRO_PRODUCTO_FISICO',
    fecha_modificacion = CURRENT_TIMESTAMP
WHERE tipo IS NULL;

ALTER TABLE fg_producto_inventariable
    ALTER COLUMN tipo SET NOT NULL;

COMMIT;
