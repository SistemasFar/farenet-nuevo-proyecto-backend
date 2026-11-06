-- Migración: Soporte para aplicación directa de descuentos por ID (sin códigos promocionales)
-- Permite persistir la referencia directa a fg_descuento(id) manteniendo compatibilidad histórica.

BEGIN;

-- 1. Agregar columna descuento_id referenciando a fg_descuento
ALTER TABLE fg_descuentocomprobante
    ADD COLUMN IF NOT EXISTS descuento_id BIGINT NULL
        CONSTRAINT fk_fg_descom_descuento REFERENCES fg_descuento(id) ON UPDATE CASCADE ON DELETE RESTRICT;

-- 2. Permitir que descuento_cliente_id sea nulo (para aplicaciones directas sin código)
ALTER TABLE fg_descuentocomprobante
    ALTER COLUMN descuento_cliente_id DROP NOT NULL;

-- 3. Poblar descuento_id en registros históricos a partir de su descuento_cliente_id
UPDATE fg_descuentocomprobante cmp
SET descuento_id = dc.descuento_id
FROM fg_descuentocliente dc
WHERE dc.id = cmp.descuento_cliente_id
  AND cmp.descuento_id IS NULL;

-- 4. Índice para optimizar consultas de reservas y reportes por descuento_id
CREATE INDEX IF NOT EXISTS idx_fg_descom_descuento_id
    ON fg_descuentocomprobante(descuento_id);

-- 5. Restricción para garantizar que al menos una referencia de descuento exista
ALTER TABLE fg_descuentocomprobante
    DROP CONSTRAINT IF EXISTS chk_fg_descom_descuento_ref;

ALTER TABLE fg_descuentocomprobante
    ADD CONSTRAINT chk_fg_descom_descuento_ref
    CHECK (descuento_id IS NOT NULL OR descuento_cliente_id IS NOT NULL);

COMMIT;
