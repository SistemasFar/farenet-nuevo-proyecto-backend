BEGIN;

-- Snapshot operativo mínimo del comprobante. Todas las columnas pertenecen a
-- FAREGAS y son nullable para no reescribir ni reinterpretar el histórico.
ALTER TABLE fg_facturacion
    ADD COLUMN IF NOT EXISTS fecha_documento DATE NULL,
    ADD COLUMN IF NOT EXISTS sede_nombre_snapshot VARCHAR(150) NULL,
    ADD COLUMN IF NOT EXISTS sede_direccion_snapshot VARCHAR(500) NULL,
    ADD COLUMN IF NOT EXISTS sede_telefono_snapshot VARCHAR(255) NULL,
    ADD COLUMN IF NOT EXISTS sede_correo_snapshot VARCHAR(255) NULL,
    ADD COLUMN IF NOT EXISTS codigo_descuento_snapshot VARCHAR(120) NULL;

COMMIT;
