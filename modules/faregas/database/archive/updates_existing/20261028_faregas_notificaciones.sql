-- Migración incremental: tablas de notificaciones persistentes por usuario
-- NO ejecutar automáticamente. Se aplica mediante el proceso de migración del proyecto.

CREATE TABLE IF NOT EXISTS fg_notificacion (
    id BIGSERIAL PRIMARY KEY,
    evento_clave VARCHAR(80) NOT NULL UNIQUE,
    tipo VARCHAR(40) NOT NULL,
    titulo VARCHAR(160) NOT NULL,
    mensaje VARCHAR(500) NOT NULL,
    planta_key VARCHAR(80),
    empresa_key VARCHAR(80),
    entidad_tipo VARCHAR(60),
    entidad_id BIGINT,
    destino_navegacion VARCHAR(200),
    fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    creado_por VARCHAR(80)
);

CREATE TABLE IF NOT EXISTS fg_notificacion_destinatario (
    id BIGSERIAL PRIMARY KEY,
    notificacion_id BIGINT NOT NULL REFERENCES fg_notificacion(id) ON DELETE CASCADE,
    usuario_id VARCHAR(80) NOT NULL,
    leida BOOLEAN NOT NULL DEFAULT FALSE,
    fecha_lectura TIMESTAMPTZ,
    UNIQUE (notificacion_id, usuario_id)
);

CREATE INDEX IF NOT EXISTS idx_fg_notificacion_destinatario_usuario ON fg_notificacion_destinatario(usuario_id);
CREATE INDEX IF NOT EXISTS idx_fg_notificacion_destinatario_leida ON fg_notificacion_destinatario(leida);
CREATE INDEX IF NOT EXISTS idx_fg_notificacion_evento_clave ON fg_notificacion(evento_clave);
CREATE INDEX IF NOT EXISTS idx_fg_notificacion_fecha ON fg_notificacion(fecha_creacion DESC);
