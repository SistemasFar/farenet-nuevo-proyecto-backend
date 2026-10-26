-- ============================================================================
-- FAREGAS FASE 4D: autoejecución excepcional de solicitudes de anulación
--
-- Permite que un usuario SISTEMAS ejecute su propia solicitud previamente
-- aprobada SÓLO cuando cuente con el permiso explícito
-- FAREGAS_SOLICITUD_AUTOEJECUTAR, confirme la operación y registre una
-- justificación obligatoria. La evidencia persistente queda en la columna
-- autorizacion_autoejecucion y en el historial inmutable de eventos.
--
-- El permiso NO se asigna automáticamente a ningún perfil: debe concederse
-- desde el administrador de perfiles (RBAC).
--
-- Migración incremental. No ejecutar sin autorización.
-- ============================================================================

BEGIN;

ALTER TABLE public.fg_solicitud_operacion
    ADD COLUMN IF NOT EXISTS autorizacion_autoejecucion boolean NOT NULL DEFAULT FALSE;

ALTER TABLE public.fg_solicitud_operacion
    DROP CONSTRAINT IF EXISTS ck_fg_solicitud_no_autoejecucion,
    ADD CONSTRAINT ck_fg_solicitud_no_autoejecucion CHECK (
        usuario_ejecucion IS NULL
        OR usuario_ejecucion IS DISTINCT FROM usuario_solicitante
        OR (usuario_ejecucion = usuario_solicitante AND autorizacion_autoejecucion = TRUE)
    );

INSERT INTO public.fg_permiso (clave, nombre, modulo, descripcion, activo)
VALUES (
    'FAREGAS_SOLICITUD_AUTOEJECUTAR',
    'Autoejecución excepcional de anulación',
    'FAREGAS',
    'Permite a un usuario SISTEMAS ejecutar su propia solicitud de anulación previamente aprobada, con confirmación explícita, justificación obligatoria y auditoría inmutable. No se asigna automáticamente a ningún perfil.',
    TRUE
)
ON CONFLICT (clave) DO UPDATE SET
    nombre = EXCLUDED.nombre,
    modulo = EXCLUDED.modulo,
    descripcion = EXCLUDED.descripcion,
    activo = EXCLUDED.activo;

COMMIT;
