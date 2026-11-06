BEGIN;

ALTER TABLE fg_tarifa
    ADD COLUMN IF NOT EXISTS producto_facturacion_id BIGINT;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_fg_tarifa_producto_facturacion'
          AND conrelid = 'fg_tarifa'::regclass
    ) THEN
        ALTER TABLE fg_tarifa
            ADD CONSTRAINT fk_fg_tarifa_producto_facturacion
            FOREIGN KEY (producto_facturacion_id)
            REFERENCES fg_producto_facturacion(id)
            ON UPDATE CASCADE
            ON DELETE RESTRICT;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_fg_tarifa_producto_facturacion
    ON fg_tarifa (producto_facturacion_id);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_fg_tarifa_precio_positivo'
          AND conrelid = 'fg_tarifa'::regclass
    ) THEN
        ALTER TABLE fg_tarifa
            ADD CONSTRAINT chk_fg_tarifa_precio_positivo CHECK (precio > 0);
    END IF;
END $$;

INSERT INTO fg_permiso (clave, nombre, modulo, descripcion, activo)
VALUES (
    'CONFIGURACION_TARIFAS',
    'Administrar Tarifas',
    'FAREGAS',
    'Administrar disponibilidad, precio y SKU de tarifas Faregas por sede',
    TRUE
)
ON CONFLICT (clave) DO NOTHING;

INSERT INTO fg_perfil_permiso (perfil_clave, permiso_clave)
SELECT 'SISTEMAS', 'CONFIGURACION_TARIFAS'
WHERE EXISTS (SELECT 1 FROM fg_perfil WHERE clave = 'SISTEMAS')
ON CONFLICT DO NOTHING;

COMMIT;
