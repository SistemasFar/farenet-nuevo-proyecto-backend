-- 
-- FAREGAS FASE 4C: Permisos para autorización de notas de crédito.
-- Agrega los permisos FAREGAS_NOTA_CREDITO_APROBAR y FAREGAS_NOTA_CREDITO_AUTOAPROBAR.
-- Corrige la restricción CHECK ck_fg_solicitud_tipo para incluir EMITIR_NOTA_CREDITO.
-- No modifica solicitudes históricas ni permisos existentes.
--

-- 1. Agregar permisos nuevos
INSERT INTO public.fg_permiso (clave, nombre, modulo, descripcion, activo)
VALUES
    ('FAREGAS_NOTA_CREDITO_APROBAR', 'Aprobar o rechazar solicitudes de nota de crédito FAREGAS', 'FAREGAS', 'Permite aprobar o rechazar solicitudes administrativas de autorización de notas de crédito dentro de las sedes autorizadas.', TRUE),
    ('FAREGAS_NOTA_CREDITO_AUTOAPROBAR', 'Autoaprobar solicitud propia de nota de crédito FAREGAS', 'FAREGAS', 'Permite autoaprobar una solicitud propia de nota de crédito únicamente si también se tiene el permiso FAREGAS_NOTA_CREDITO_APROBAR.', TRUE)
ON CONFLICT (clave) DO UPDATE
SET nombre = EXCLUDED.nombre,
    modulo = EXCLUDED.modulo,
    descripcion = EXCLUDED.descripcion,
    activo = EXCLUDED.activo;

-- 2. Asignar los nuevos permisos al perfil SISTEMAS (para desarrollo y pruebas)
INSERT INTO public.fg_perfil_permiso (perfil_clave, permiso_clave)
SELECT perfil.clave, permiso.clave
FROM public.fg_perfil perfil
CROSS JOIN (
    VALUES
        ('FAREGAS_NOTA_CREDITO_APROBAR'::varchar),
        ('FAREGAS_NOTA_CREDITO_AUTOAPROBAR'::varchar)
) permiso(clave)
WHERE perfil.clave = 'SISTEMAS'
ON CONFLICT (perfil_clave, permiso_clave) DO NOTHING;

-- 3. Corregir restricción CHECK para incluir EMITIR_NOTA_CREDITO en tipo_operacion
ALTER TABLE public.fg_solicitud_operacion DROP CONSTRAINT IF EXISTS ck_fg_solicitud_tipo;
ALTER TABLE public.fg_solicitud_operacion ADD CONSTRAINT ck_fg_solicitud_tipo CHECK (
    tipo_operacion IN (
        'ANULAR_CERTIFICADO',
        'ANULAR_COMPROBANTE',
        'ANULAR_AMBOS',
        'EMITIR_NOTA_CREDITO',
        'RECTIFICAR_CERTIFICADO',
        'RECTIFICAR_COMPROBANTE',
        'RECTIFICAR_AMBOS'
    )
);
