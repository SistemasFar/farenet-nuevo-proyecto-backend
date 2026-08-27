-- Catálogo propio de ejecutivos FAREGAS.
-- Permite conservar el nombre visible y enlazar opcionalmente un usuario FAREGAS.

CREATE TABLE IF NOT EXISTS fg_ejecutivo (
    id BIGSERIAL PRIMARY KEY,
    username VARCHAR(255) NULL,
    nombre VARCHAR(200) NOT NULL,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    usuario_creacion VARCHAR(255) NOT NULL,
    fecha_creacion TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    usuario_modificacion VARCHAR(255) NULL,
    fecha_modificacion TIMESTAMP NULL,
    CONSTRAINT fk_fg_ejecutivo_usuario
        FOREIGN KEY (username) REFERENCES fg_usuario(username) ON UPDATE CASCADE,
    CONSTRAINT fk_fg_ejecutivo_usu_crea
        FOREIGN KEY (usuario_creacion) REFERENCES fg_usuario(username) ON UPDATE CASCADE,
    CONSTRAINT fk_fg_ejecutivo_usu_mod
        FOREIGN KEY (usuario_modificacion) REFERENCES fg_usuario(username) ON UPDATE CASCADE,
    CONSTRAINT ck_fg_ejecutivo_nombre
        CHECK (BTRIM(nombre) <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_fg_ejecutivo_nombre
    ON fg_ejecutivo (LOWER(BTRIM(nombre)));

ALTER TABLE fg_descuento
    ADD COLUMN IF NOT EXISTS ejecutivo_id BIGINT NULL;

INSERT INTO fg_ejecutivo (nombre, usuario_creacion)
SELECT DISTINCT BTRIM(d.ejecutivo), d.usuario_creacion
FROM fg_descuento d
WHERE NULLIF(BTRIM(d.ejecutivo), '') IS NOT NULL
ON CONFLICT DO NOTHING;

UPDATE fg_descuento d
SET ejecutivo_id = e.id
FROM fg_ejecutivo e
WHERE d.ejecutivo_id IS NULL
  AND NULLIF(BTRIM(d.ejecutivo), '') IS NOT NULL
  AND LOWER(BTRIM(e.nombre)) = LOWER(BTRIM(d.ejecutivo));

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_fg_descuento_ejecutivo'
    ) THEN
        ALTER TABLE fg_descuento
            ADD CONSTRAINT fk_fg_descuento_ejecutivo
            FOREIGN KEY (ejecutivo_id) REFERENCES fg_ejecutivo(id) ON UPDATE CASCADE;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS ix_fg_descuento_ejecutivo
    ON fg_descuento (ejecutivo_id)
    WHERE ejecutivo_id IS NOT NULL;

COMMENT ON TABLE fg_ejecutivo IS
    'Catálogo de colaboradores responsables de alianzas FAREGAS';

COMMENT ON COLUMN fg_descuento.ejecutivo IS
    'Nombre histórico del ejecutivo al momento de registrar el descuento';

COMMENT ON COLUMN fg_descuento.ejecutivo_id IS
    'Ejecutivo FAREGAS relacionado con la alianza';
