-- FAREGAS: rangos de certificados por sede y modalidad exacta.
-- Conserva los rangos existentes y evita duplicar números completos entre
-- sedes/modalidades que comparten el mismo prefijo de certificado.

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE fg_correlativo_certificado
    ADD COLUMN IF NOT EXISTS modalidad VARCHAR(20);

UPDATE fg_correlativo_certificado
SET modalidad = CASE
    WHEN tipo_certificado_clave = 'CONFORMIDAD' THEN 'UNICA'
    ELSE 'ANUAL'
END
WHERE modalidad IS NULL;

ALTER TABLE fg_correlativo_certificado
    ALTER COLUMN modalidad SET NOT NULL;

ALTER TABLE fg_correlativo_certificado
    DROP CONSTRAINT IF EXISTS chk_fg_correlativo_modalidad;

ALTER TABLE fg_correlativo_certificado
    ADD CONSTRAINT chk_fg_correlativo_modalidad
    CHECK (modalidad IN ('INICIAL', 'ANUAL', 'UNICA'));

ALTER TABLE fg_correlativo_certificado
    DROP CONSTRAINT IF EXISTS excl_fg_correlativo_rango;

ALTER TABLE fg_correlativo_certificado
    DROP CONSTRAINT IF EXISTS fg_correlativo_certificado_hist_key;

DROP INDEX IF EXISTS fg_correlativo_certificado_activo_idx;

-- El número completo no contiene la sede. Por eso dos sedes o modalidades
-- con el mismo prefijo no pueden recibir rangos numéricos superpuestos.
ALTER TABLE fg_correlativo_certificado
    ADD CONSTRAINT excl_fg_correlativo_rango
    EXCLUDE USING gist (
        tipo_certificado_clave WITH =,
        int8range(nro_inicio, nro_maximo, '[]') WITH &&
    );

ALTER TABLE fg_correlativo_certificado
    ADD CONSTRAINT fg_correlativo_certificado_hist_key
    UNIQUE (planta_key, tipo_certificado_clave, modalidad, nro_inicio, nro_maximo);

CREATE UNIQUE INDEX fg_correlativo_certificado_activo_idx
    ON fg_correlativo_certificado (planta_key, tipo_certificado_clave, modalidad)
    WHERE activo = TRUE;

CREATE INDEX IF NOT EXISTS idx_fg_correlativo_certificado_listado
    ON fg_correlativo_certificado (planta_key, tipo_certificado_clave, modalidad, activo);

-- Los cinco formatos entregados y las plantillas FAREGAS usan DG-41 para GLP.
UPDATE fg_tipo_certificado
SET codigo = '41'
WHERE clave = 'GLP_ANUAL' AND codigo <> '41';

COMMENT ON COLUMN fg_correlativo_certificado.modalidad IS
    'Modalidad exacta del rango: INICIAL, ANUAL o UNICA para Conformidad.';
