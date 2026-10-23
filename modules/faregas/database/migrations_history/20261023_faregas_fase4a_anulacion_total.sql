BEGIN;

-- FAREGAS Fase 4A / Paso A
-- Unifica el alta pública en ANULAR_AMBOS. La facturación puede ser NULL sólo
-- para registrar de forma veraz que el proceso no llegó a emitir comprobante;
-- esto no equivale a una baja fiscal aceptada.
ALTER TABLE public.fg_solicitud_operacion
    DROP CONSTRAINT IF EXISTS ck_fg_solicitud_documentos;

ALTER TABLE public.fg_solicitud_operacion
    ADD CONSTRAINT ck_fg_solicitud_documentos CHECK (
        (tipo_operacion IN ('ANULAR_CERTIFICADO', 'RECTIFICAR_CERTIFICADO') AND certificado_id IS NOT NULL)
        OR (tipo_operacion IN ('ANULAR_COMPROBANTE', 'RECTIFICAR_COMPROBANTE') AND facturacion_id IS NOT NULL)
        OR (tipo_operacion = 'ANULAR_AMBOS' AND certificado_id IS NOT NULL)
        OR (tipo_operacion = 'RECTIFICAR_AMBOS' AND certificado_id IS NOT NULL AND facturacion_id IS NOT NULL)
    );

UPDATE public.fg_permiso
SET nombre = 'Crear solicitudes de anulación total FAREGAS',
    descripcion = 'Permite al OPERADOR solicitar la anulación total del certificado y su comprobante asociado sin ejecutarla.',
    activo = TRUE
WHERE clave = 'FAREGAS_SOLICITUD_CREAR';

-- JEFE_PLANTA deja de decidir o ejecutar cualquier componente del nuevo flujo.
DELETE FROM public.fg_perfil_permiso
WHERE perfil_clave = 'JEFE_PLANTA'
  AND permiso_clave IN (
      'FAREGAS_SOLICITUD_APROBAR',
      'FAREGAS_SOLICITUD_RECHAZAR',
      'FAREGAS_SOLICITUD_ADMINISTRAR',
      'FAREGAS_CERTIFICADO_ANULAR_EJECUTAR',
      'FAREGAS_CERTIFICADO_RECTIFICAR_EJECUTAR',
      'FAREGAS_ANULAR_COMPROBANTE',
      'FAREGAS_NOTA_CREDITO'
  );

-- SISTEMAS revisa y ejecutará en el Paso B, pero no origina solicitudes.
DELETE FROM public.fg_perfil_permiso
WHERE perfil_clave = 'SISTEMAS'
  AND permiso_clave IN ('FAREGAS_SOLICITUD_CREAR', 'FAREGAS_CERTIFICADO_RECTIFICAR_EJECUTAR');

INSERT INTO public.fg_perfil_permiso (perfil_clave, permiso_clave)
SELECT asignacion.perfil_clave, asignacion.permiso_clave
FROM (VALUES
    ('OPERADOR'::varchar, 'FAREGAS_SOLICITUD_CREAR'::varchar),
    ('OPERADOR'::varchar, 'FAREGAS_SOLICITUD_VER'::varchar),
    ('SISTEMAS'::varchar, 'FAREGAS_SOLICITUD_VER'::varchar),
    ('SISTEMAS'::varchar, 'FAREGAS_SOLICITUD_APROBAR'::varchar),
    ('SISTEMAS'::varchar, 'FAREGAS_SOLICITUD_RECHAZAR'::varchar),
    ('SISTEMAS'::varchar, 'FAREGAS_SOLICITUD_ADMINISTRAR'::varchar),
    ('SISTEMAS'::varchar, 'FAREGAS_CERTIFICADO_ANULAR_EJECUTAR'::varchar),
    ('SISTEMAS'::varchar, 'FAREGAS_ANULAR_COMPROBANTE'::varchar),
    ('SISTEMAS'::varchar, 'FAREGAS_NOTA_CREDITO'::varchar)
) AS asignacion(perfil_clave, permiso_clave)
JOIN public.fg_perfil perfil ON perfil.clave = asignacion.perfil_clave
JOIN public.fg_permiso permiso ON permiso.clave = asignacion.permiso_clave AND permiso.activo = TRUE
ON CONFLICT (perfil_clave, permiso_clave) DO NOTHING;

COMMIT;
