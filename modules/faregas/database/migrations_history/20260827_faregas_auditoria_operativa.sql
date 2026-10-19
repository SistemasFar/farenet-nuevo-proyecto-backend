BEGIN;

-- Amplía la bitácora de accesos existente para cubrir toda la operación
-- FAREGAS sin perder los registros históricos ya almacenados.
ALTER TABLE fg_auditoria_acceso
    ADD COLUMN IF NOT EXISTS categoria VARCHAR(30) NOT NULL DEFAULT 'ACCESO',
    ADD COLUMN IF NOT EXISTS entidad VARCHAR(50),
    ADD COLUMN IF NOT EXISTS entidad_id BIGINT,
    ADD COLUMN IF NOT EXISTS certificado_id BIGINT,
    ADD COLUMN IF NOT EXISTS numero_certificado VARCHAR(80),
    ADD COLUMN IF NOT EXISTS placa VARCHAR(20),
    ADD COLUMN IF NOT EXISTS tipo_certificado VARCHAR(50),
    ADD COLUMN IF NOT EXISTS paso VARCHAR(50),
    ADD COLUMN IF NOT EXISTS datos JSONB,
    ADD COLUMN IF NOT EXISTS perfil VARCHAR(50);

UPDATE fg_auditoria_acceso
SET categoria = 'ACCESO'
WHERE categoria IS NULL OR BTRIM(categoria) = '';

UPDATE fg_auditoria_acceso a
SET perfil = u.perfil_id
FROM fg_usuario u
WHERE a.perfil IS NULL
  AND u.username = a.username;

CREATE INDEX IF NOT EXISTS ix_fg_auditoria_categoria_fecha
    ON fg_auditoria_acceso (categoria, fecha_evento DESC);

CREATE INDEX IF NOT EXISTS ix_fg_auditoria_certificado
    ON fg_auditoria_acceso (certificado_id, fecha_evento DESC)
    WHERE certificado_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_fg_auditoria_placa
    ON fg_auditoria_acceso (placa, fecha_evento DESC)
    WHERE placa IS NOT NULL;

COMMENT ON TABLE fg_auditoria_acceso IS
    'Bitácora inmutable de accesos y operaciones relevantes del subsistema FAREGAS';

COMMENT ON COLUMN fg_auditoria_acceso.datos IS
    'Resumen técnico no sensible del evento; no debe almacenar contraseñas, tokens ni datos completos de pago';

COMMENT ON COLUMN fg_auditoria_acceso.perfil IS
    'Perfil histórico que tenía el usuario al momento de la operación';

COMMIT;
