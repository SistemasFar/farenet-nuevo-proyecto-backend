BEGIN;

-- El concepto inventariable es único, pero el SKU con el que se factura puede
-- variar por sede (por ejemplo: CHIP + PORTA CHIP - COLINA / SURCO / etc.).
ALTER TABLE fg_producto_inventariable_sede
    ADD COLUMN IF NOT EXISTS producto_facturacion_id BIGINT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'fk_fg_producto_inventariable_sede_producto_facturacion'
    ) THEN
        ALTER TABLE fg_producto_inventariable_sede
            ADD CONSTRAINT fk_fg_producto_inventariable_sede_producto_facturacion
            FOREIGN KEY (producto_facturacion_id)
            REFERENCES fg_producto_facturacion(id)
            ON UPDATE CASCADE ON DELETE RESTRICT;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS ix_fg_producto_inventariable_sede_producto_fiscal
    ON fg_producto_inventariable_sede(producto_facturacion_id);

-- Compatibilidad con cualquier producto que ya tuviera un SKU global.
UPDATE fg_producto_inventariable_sede pis
SET producto_facturacion_id = pi.producto_facturacion_id,
    fecha_modificacion = CURRENT_TIMESTAMP
FROM fg_producto_inventariable pi
WHERE pi.id = pis.producto_inventariable_id
  AND pis.producto_facturacion_id IS NULL
  AND pi.producto_facturacion_id IS NOT NULL;

-- Evidencia del catálogo Productos-2026-08-19: el producto CHIP tiene SKU
-- independiente en estas cuatro sedes. No se habilita la venta automáticamente.
WITH evidencia(planta_nombre, codigo_sku) AS (
    VALUES
        ('COLINA', 'CHIP + PORTA CHIP - COLINA'),
        ('TRENEMAN', 'CHIP + PORTA CHIP - TRENEMAN'),
        ('SURQUILLO', 'CHIP + PORTA CHIP - SURQUILLO'),
        ('SURCO', 'CHIP + PORTA CHIP - SURCO')
)
UPDATE fg_producto_inventariable_sede pis
SET producto_facturacion_id = pf.id,
    fecha_modificacion = CURRENT_TIMESTAMP
FROM fg_producto_inventariable pi,
     fg_planta p,
     fg_producto_facturacion pf,
     evidencia e
WHERE pis.producto_inventariable_id = pi.id
  AND pis.planta_key = p.key
  AND pi.codigo = 'CHIP'
  AND UPPER(BTRIM(p.nombre)) = e.planta_nombre
  AND pf.codigo_sku = e.codigo_sku
  AND pis.producto_facturacion_id IS DISTINCT FROM pf.id;

INSERT INTO fg_permiso (clave, nombre, modulo, descripcion, activo)
VALUES (
    'CHIPS_CONFIGURAR',
    'Configurar productos inventariables',
    'FAREGAS',
    'Crear y editar productos inventariables y su disponibilidad por sede',
    TRUE
)
ON CONFLICT (clave) DO UPDATE
SET nombre = EXCLUDED.nombre,
    descripcion = EXCLUDED.descripcion,
    activo = TRUE;

INSERT INTO fg_perfil_permiso (perfil_clave, permiso_clave)
SELECT 'SISTEMAS', 'CHIPS_CONFIGURAR'
WHERE EXISTS (SELECT 1 FROM fg_perfil WHERE clave = 'SISTEMAS')
ON CONFLICT DO NOTHING;

COMMIT;
