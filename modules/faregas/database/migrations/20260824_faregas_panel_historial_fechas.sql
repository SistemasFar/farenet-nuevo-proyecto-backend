BEGIN;

-- Acelera el panel diario y las consultas históricas por rango dentro de sede.
CREATE INDEX IF NOT EXISTS ix_fg_certificado_panel_fecha_creacion
    ON fg_certificado (planta_key, estado, fecha_creacion DESC, id DESC);

COMMIT;
