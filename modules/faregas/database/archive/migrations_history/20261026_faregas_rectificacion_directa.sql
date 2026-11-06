-- ============================================================================
-- FAREGAS - RECTIFICACIÓN DIRECTA DE CERTIFICADOS
-- Generado el 2026-10-26
--
-- Actualiza únicamente la denominación del permiso técnico existente para que
-- pueda asignarse explícitamente a CAJERO u otros perfiles desde la gestión de
-- permisos. No concede el permiso automáticamente, no modifica certificados y
-- no toca comprobantes, pagos ni correlativos DG.
--
-- NO ejecutar automáticamente. Aplicar mediante el procedimiento controlado de
-- migraciones del ambiente correspondiente.
-- ============================================================================

BEGIN;

INSERT INTO public.fg_permiso (clave, nombre, modulo, descripcion, activo)
VALUES (
    'FAREGAS_CERTIFICADO_RECTIFICAR_EJECUTAR',
    'Rectificar directamente un certificado',
    'FAREGAS',
    'Permite rectificar directamente un certificado emitido, con versionado y auditoría, sin alterar comprobantes, pagos, fecha original ni correlativo DG.',
    TRUE
)
ON CONFLICT (clave) DO UPDATE SET
    nombre = EXCLUDED.nombre,
    modulo = EXCLUDED.modulo,
    descripcion = EXCLUDED.descripcion,
    activo = EXCLUDED.activo;

COMMIT;
