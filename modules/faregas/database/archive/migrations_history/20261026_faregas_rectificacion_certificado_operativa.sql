-- ============================================================================
-- FAREGAS - RECTIFICACIÓN OPERATIVA DE CERTIFICADOS EMITIDOS
-- Generado el 2026-10-26
--
-- Endurecimiento incremental para la rectificación técnica:
-- 1. Índice de consulta de historial por certificado, tipo, estado y fecha.
-- 2. Unicidad de solicitud activa por certificado, necesaria para impedir
--    rectificaciones simultáneas junto con el bloqueo FOR UPDATE del servicio.
-- 3. Permiso de ejecución de rectificación y asignación exclusiva a SISTEMAS.
--
-- La migración es idempotente. NO ejecuta la aplicación de rectificaciones ni
-- modifica datos de certificados, comprobantes, pagos o correlativos.
--
-- REGLA: No ejecutar automáticamente sobre 192.168.14.19/inspeccion. Requiere
-- autorización expresa.
-- ============================================================================

BEGIN;

CREATE INDEX IF NOT EXISTS idx_fg_solicitud_cert_tipo_estado
    ON public.fg_solicitud_operacion
    (certificado_id, tipo_operacion, estado, fecha_solicitud DESC);

-- La base ya cuenta con esta garantía; se reafirma para instalaciones donde la
-- migración de solicitudes administrativas se aplicó parcialmente.
CREATE UNIQUE INDEX IF NOT EXISTS uq_fg_solicitud_activa_certificado
    ON public.fg_solicitud_operacion (certificado_id)
    WHERE certificado_id IS NOT NULL
      AND estado IN ('PENDIENTE_APROBACION', 'APROBADA', 'EN_EJECUCION', 'REQUIERE_INTERVENCION');

INSERT INTO public.fg_permiso (clave, nombre, modulo, descripcion, activo)
VALUES (
    'FAREGAS_CERTIFICADO_RECTIFICAR_EJECUTAR',
    'Ejecutar rectificación técnica de certificado',
    'FAREGAS',
    'Permite ejecutar la rectificación técnica y el versionado de un certificado emitido con solicitud administrativa aprobada, sin emitir comprobantes ni consumir correlativos.',
    TRUE
)
ON CONFLICT (clave) DO UPDATE SET
    nombre = EXCLUDED.nombre,
    modulo = EXCLUDED.modulo,
    descripcion = EXCLUDED.descripcion,
    activo = EXCLUDED.activo;

INSERT INTO public.fg_perfil_permiso (perfil_clave, permiso_clave)
SELECT perfil.clave, 'FAREGAS_CERTIFICADO_RECTIFICAR_EJECUTAR'
FROM public.fg_perfil perfil
WHERE perfil.clave = 'SISTEMAS'
ON CONFLICT (perfil_clave, permiso_clave) DO NOTHING;

COMMIT;
