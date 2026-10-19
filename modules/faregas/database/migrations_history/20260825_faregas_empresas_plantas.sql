BEGIN;

-- Copia independiente para que FAREGAS pueda administrar sus empresas sin
-- escribir sobre la tabla legacy empresa de FARENET.
CREATE TABLE IF NOT EXISTS fg_empresa (
    key VARCHAR PRIMARY KEY,
    nombre VARCHAR NOT NULL,
    ruc VARCHAR NULL,
    direccion VARCHAR NULL,
    telefono VARCHAR NULL,
    cuenta_banco_nacion VARCHAR NULL,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_creacion TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_modificacion TIMESTAMP WITHOUT TIME ZONE NULL,
    CONSTRAINT chk_fg_empresa_key CHECK (BTRIM(key) <> ''),
    CONSTRAINT chk_fg_empresa_nombre CHECK (BTRIM(nombre) <> ''),
    CONSTRAINT chk_fg_empresa_ruc CHECK (ruc IS NULL OR ruc ~ '^[0-9]{11}$')
);

CREATE INDEX IF NOT EXISTS idx_fg_empresa_listado
    ON fg_empresa (activo DESC, nombre);

INSERT INTO fg_empresa (
    key, nombre, ruc, direccion, telefono, cuenta_banco_nacion, activo
)
SELECT e.key, e.nombre, NULLIF(BTRIM(e.ruc), ''), e.direccion,
       e.telefono, e.ctabanconacion, TRUE
FROM empresa e
ON CONFLICT (key) DO NOTHING;

ALTER TABLE fg_planta
    ADD COLUMN IF NOT EXISTS empresa_key VARCHAR NULL;

-- Las sedes reales conservan exactamente su relación histórica.
UPDATE fg_planta fp
SET empresa_key = p.empresa_key
FROM planta p
JOIN fg_empresa fe ON fe.key = p.empresa_key
WHERE p.key = fp.key
  AND fp.empresa_key IS NULL;

-- Las sedes sin antecedente legacy (actualmente TEST_P1 y TEST_P2) quedan
-- vinculadas a FAREGAS para mantener la relación obligatoria.
UPDATE fg_planta
SET empresa_key = 'FAREGAS'
WHERE empresa_key IS NULL;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM fg_planta WHERE empresa_key IS NULL) THEN
        RAISE EXCEPTION 'No fue posible asignar una empresa a todas las sedes FAREGAS.';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_fg_planta_empresa'
          AND conrelid = 'fg_planta'::regclass
    ) THEN
        ALTER TABLE fg_planta
            ADD CONSTRAINT fk_fg_planta_empresa
            FOREIGN KEY (empresa_key) REFERENCES fg_empresa(key)
            ON UPDATE CASCADE ON DELETE RESTRICT;
    END IF;
END $$;

ALTER TABLE fg_planta
    ALTER COLUMN empresa_key SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_fg_planta_empresa
    ON fg_planta (empresa_key, activo, nombre);

INSERT INTO fg_permiso (clave, nombre, modulo, descripcion, activo)
VALUES (
    'CONFIGURACION_EMPRESAS',
    'Administrar Empresas FAREGAS',
    'FAREGAS',
    'Editar empresas y asignar sus sedes en FAREGAS',
    TRUE
)
ON CONFLICT (clave) DO NOTHING;

INSERT INTO fg_perfil_permiso (perfil_clave, permiso_clave)
SELECT 'SISTEMAS', 'CONFIGURACION_EMPRESAS'
WHERE EXISTS (SELECT 1 FROM fg_perfil WHERE clave = 'SISTEMAS')
ON CONFLICT DO NOTHING;

COMMIT;
