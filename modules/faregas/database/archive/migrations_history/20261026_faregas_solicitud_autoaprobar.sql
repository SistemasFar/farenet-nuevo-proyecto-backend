BEGIN;

INSERT INTO public.fg_permiso (clave, nombre, modulo, descripcion, activo)
VALUES (
    'FAREGAS_SOLICITUD_AUTOAPROBAR',
    'Autoaprobar anulación excepcional',
    'FAREGAS',
    'Permite a SISTEMAS aprobar excepcionalmente una solicitud propia con justificación y confirmación explícitas. No habilita la ejecución fiscal.',
    TRUE
)
ON CONFLICT (clave) DO UPDATE SET
    nombre = EXCLUDED.nombre,
    modulo = EXCLUDED.modulo,
    descripcion = EXCLUDED.descripcion,
    activo = EXCLUDED.activo;

-- SISTEMAS puede aprobar su propia solicitud, pero este permiso no habilita
-- la ejecución fiscal por el mismo usuario.
INSERT INTO public.fg_perfil_permiso (perfil_clave, permiso_clave)
SELECT perfil.clave, permiso.clave
FROM public.fg_perfil perfil
JOIN public.fg_permiso permiso
  ON permiso.clave = 'FAREGAS_SOLICITUD_AUTOAPROBAR'
 AND permiso.activo = TRUE
WHERE perfil.clave = 'SISTEMAS'
ON CONFLICT (perfil_clave, permiso_clave) DO NOTHING;

-- La autorización excepcional se valida en el servicio mediante perfil
-- SISTEMAS + APROBAR + AUTOAPROBAR + confirmación y justificación. Se retira
-- únicamente la prohibición absoluta de autoaprobación; la prohibición de
-- autoejecución permanece como restricción independiente en PostgreSQL.
ALTER TABLE public.fg_solicitud_operacion
    DROP CONSTRAINT IF EXISTS ck_fg_solicitud_no_autoaprobacion;

COMMIT;
