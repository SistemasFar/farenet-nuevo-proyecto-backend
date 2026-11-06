BEGIN;

-- FAREGAS Fase 4C: unificación de solicitudes y permisos en Inicio.
-- Sólo ajusta nombres y asignaciones RBAC. No modifica documentos, pagos,
-- correlativos ni estados de solicitudes existentes.
UPDATE public.fg_permiso
SET nombre = CASE clave
        WHEN 'FAREGAS_SOLICITUD_CREAR' THEN 'Solicitar anulación total'
        WHEN 'FAREGAS_SOLICITUD_VER' THEN 'Consultar solicitudes de anulación'
        WHEN 'FAREGAS_SOLICITUD_APROBAR' THEN 'Aprobar anulaciones'
        WHEN 'FAREGAS_SOLICITUD_RECHAZAR' THEN 'Rechazar anulaciones'
        WHEN 'FAREGAS_SOLICITUD_ADMINISTRAR' THEN 'Administrar solicitudes de anulación'
        WHEN 'FAREGAS_CERTIFICADO_ANULAR_EJECUTAR' THEN 'Ejecutar anulación autorizada'
        WHEN 'FAREGAS_NOTA_CREDITO' THEN 'Emitir nota de crédito'
        WHEN 'FAREGAS_ANULAR_COMPROBANTE' THEN 'Anular comprobante electrónico'
        ELSE nombre
    END,
    descripcion = CASE clave
        WHEN 'FAREGAS_SOLICITUD_CREAR' THEN 'Permite a un perfil autorizado por RBAC solicitar la anulación total sin aprobarla ni ejecutarla.'
        WHEN 'FAREGAS_SOLICITUD_APROBAR' THEN 'Permite a SISTEMAS aprobar solicitudes de otro usuario dentro del alcance autorizado.'
        WHEN 'FAREGAS_SOLICITUD_RECHAZAR' THEN 'Permite a SISTEMAS rechazar solicitudes de otro usuario dentro del alcance autorizado.'
        WHEN 'FAREGAS_CERTIFICADO_ANULAR_EJECUTAR' THEN 'Permite a SISTEMAS iniciar la ejecución de una anulación total aprobada y ajena.'
        ELSE descripcion
    END,
    activo = TRUE
WHERE clave IN (
    'FAREGAS_SOLICITUD_CREAR',
    'FAREGAS_SOLICITUD_VER',
    'FAREGAS_SOLICITUD_APROBAR',
    'FAREGAS_SOLICITUD_RECHAZAR',
    'FAREGAS_SOLICITUD_ADMINISTRAR',
    'FAREGAS_CERTIFICADO_ANULAR_EJECUTAR',
    'FAREGAS_NOTA_CREDITO',
    'FAREGAS_ANULAR_COMPROBANTE'
);

-- SISTEMAS puede originar una solicitud por RBAC, pero las validaciones del
-- backend mantienen la prohibición de autoaprobarla y autoejecutarla.
INSERT INTO public.fg_perfil_permiso (perfil_clave, permiso_clave)
SELECT perfil.clave, permiso.clave
FROM public.fg_perfil perfil
JOIN public.fg_permiso permiso
  ON permiso.clave = 'FAREGAS_SOLICITUD_CREAR'
 AND permiso.activo = TRUE
WHERE perfil.clave = 'SISTEMAS'
ON CONFLICT (perfil_clave, permiso_clave) DO NOTHING;

COMMIT;
