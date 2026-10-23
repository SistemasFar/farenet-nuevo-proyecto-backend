BEGIN;

-- FASE 2: Anulación técnica de certificados emitidos mediante solicitudes previamente aprobadas.
-- Esta migración no modifica comprobantes, notas de crédito, pagos ni correlativos DG.

ALTER TABLE fg_certificado
    ADD COLUMN IF NOT EXISTS fecha_anulacion timestamp with time zone,
    ADD COLUMN IF NOT EXISTS motivo_anulacion character varying(500),
    ADD COLUMN IF NOT EXISTS solicitud_anulacion_id bigint,
    ADD COLUMN IF NOT EXISTS usuario_anulacion character varying(255);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_fg_certificado_solicitud'
    ) THEN
        ALTER TABLE fg_certificado
            ADD CONSTRAINT fk_fg_certificado_solicitud
            FOREIGN KEY (solicitud_anulacion_id) REFERENCES fg_solicitud_operacion(id) ON DELETE RESTRICT;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_fg_certificado_usuario_anulacion'
    ) THEN
        ALTER TABLE fg_certificado
            ADD CONSTRAINT fk_fg_certificado_usuario_anulacion
            FOREIGN KEY (usuario_anulacion) REFERENCES fg_usuario(username) ON DELETE RESTRICT;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_fg_certificado_solicitud_anulacion
    ON fg_certificado (solicitud_anulacion_id)
    WHERE solicitud_anulacion_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_fg_certificado_anulado
    ON fg_certificado (estado, fecha_anulacion DESC)
    WHERE estado = 'ANULADO';

-- Nuevo permiso institucional para ejecutar anulaciones técnicas de certificados
INSERT INTO fg_permiso (clave, nombre, modulo, descripcion, activo)
VALUES (
    'FAREGAS_CERTIFICADO_ANULAR_EJECUTAR',
    'Ejecutar anulación técnica de certificado',
    'FAREGAS',
    'Permite ejecutar la anulación técnica de un certificado emitido con solicitud aprobada.',
    TRUE
)
ON CONFLICT (clave) DO UPDATE
SET nombre = EXCLUDED.nombre,
    modulo = EXCLUDED.modulo,
    descripcion = EXCLUDED.descripcion,
    activo = EXCLUDED.activo;

-- Asignación inicial: Sólo SISTEMAS (OPERADOR: NO, JEFE_PLANTA: NO inicialmente)
INSERT INTO fg_perfil_permiso (perfil_clave, permiso_clave)
VALUES ('SISTEMAS', 'FAREGAS_CERTIFICADO_ANULAR_EJECUTAR')
ON CONFLICT (perfil_clave, permiso_clave) DO NOTHING;

COMMIT;
