BEGIN;

ALTER TABLE fg_producto_facturacion
    ADD COLUMN IF NOT EXISTS categoria_id INTEGER;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'fk_fg_producto_facturacion_categoria'
          AND conrelid = 'fg_producto_facturacion'::regclass
    ) THEN
        ALTER TABLE fg_producto_facturacion
            ADD CONSTRAINT fk_fg_producto_facturacion_categoria
            FOREIGN KEY (categoria_id)
            REFERENCES fg_categoria_servicio(id)
            ON UPDATE CASCADE
            ON DELETE RESTRICT;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_fg_producto_facturacion_categoria
    ON fg_producto_facturacion (categoria_id, activo);

-- Se completa únicamente cuando todas las tarifas históricas del producto
-- apuntan a servicios de una misma categoría. Los casos ambiguos permanecen
-- sin clasificar para que un administrador los revise sin inventar datos.
WITH categorias_unicas AS (
    SELECT
        t.producto_facturacion_id,
        MIN(s.categoria_id) AS categoria_id
    FROM fg_tarifa t
    JOIN fg_servicio s ON s.id = t.servicio_id
    WHERE t.producto_facturacion_id IS NOT NULL
    GROUP BY t.producto_facturacion_id
    HAVING COUNT(DISTINCT s.categoria_id) = 1
)
UPDATE fg_producto_facturacion producto
SET categoria_id = origen.categoria_id
FROM categorias_unicas origen
WHERE producto.id = origen.producto_facturacion_id
  AND producto.categoria_id IS NULL
  AND producto.codigo_sku NOT IN ('0221', '0222', '0225', '0227');

COMMENT ON COLUMN fg_producto_facturacion.categoria_id IS
    'Categoría funcional principal del producto fiscal. Puede ser NULL solo para datos históricos pendientes de clasificación.';

COMMIT;
