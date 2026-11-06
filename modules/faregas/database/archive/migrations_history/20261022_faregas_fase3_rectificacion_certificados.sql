-- ============================================================================
-- FAREGAS - FASE 3: RECTIFICACIÓN TÉCNICA Y VERSIONADO DE CERTIFICADOS
-- Generado el 2026-10-22
--
-- Agrega:
-- 1. Tabla fg_certificado_version para versionado histórico y snapshots inmutables.
-- 2. Restricciones e índices para control de unicidad de versiones y única versión vigente.
-- 3. Permiso FAREGAS_CERTIFICADO_RECTIFICAR_EJECUTAR asignado a perfil SISTEMAS.
--
-- REGLA: Este archivo NO debe ejecutarse automáticamente sobre la base de datos
-- compartida 192.168.14.19/inspeccion.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.fg_certificado_version (
    id bigserial PRIMARY KEY,
    certificado_id bigint NOT NULL REFERENCES public.fg_certificado(id) ON DELETE RESTRICT,
    solicitud_id bigint REFERENCES public.fg_solicitud_operacion(id) ON DELETE SET NULL,
    numero_version integer NOT NULL,
    estado_version varchar(30) NOT NULL,
    es_vigente boolean NOT NULL DEFAULT FALSE,
    fecha_emision_original date NOT NULL,
    fecha_version timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_aplicacion_oficial timestamptz,
    usuario_creacion varchar(255) NOT NULL REFERENCES public.fg_usuario(username) ON DELETE RESTRICT,
    usuario_aprobacion varchar(255) REFERENCES public.fg_usuario(username) ON DELETE RESTRICT,
    motivo text NOT NULL,
    snapshot_datos jsonb NOT NULL,
    diferencias jsonb,
    enlace_pdf_original text,
    enlace_pdf_version text,
    metadatos jsonb,
    CONSTRAINT ck_fg_certificado_version_estado CHECK (
        estado_version IN ('ORIGINAL', 'PROPUESTA', 'PREPARADA', 'VIGENTE', 'SUSTITUIDA', 'RECHAZADA')
    ),
    CONSTRAINT uq_fg_certificado_version_num UNIQUE (certificado_id, numero_version)
);

CREATE INDEX IF NOT EXISTS idx_fg_cert_ver_certificado ON public.fg_certificado_version (certificado_id, numero_version DESC);
CREATE INDEX IF NOT EXISTS idx_fg_cert_ver_solicitud ON public.fg_certificado_version (solicitud_id);
CREATE INDEX IF NOT EXISTS idx_fg_cert_ver_estado ON public.fg_certificado_version (estado_version, fecha_version DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_fg_cert_ver_unica_vigente ON public.fg_certificado_version (certificado_id)
    WHERE es_vigente = TRUE;

-- Registrar nuevo permiso RBAC para rectificación técnica
INSERT INTO public.fg_permiso (clave, nombre, modulo, descripcion, activo)
VALUES (
    'FAREGAS_CERTIFICADO_RECTIFICAR_EJECUTAR',
    'Ejecutar rectificación técnica de certificado',
    'FAREGAS',
    'Permite ejecutar la rectificación técnica y versionado de un certificado emitido con solicitud administrativa aprobada.',
    TRUE
)
ON CONFLICT (clave) DO UPDATE SET
    nombre = EXCLUDED.nombre,
    modulo = EXCLUDED.modulo,
    descripcion = EXCLUDED.descripcion,
    activo = EXCLUDED.activo;

-- Asignación inicial exclusiva a SISTEMAS
INSERT INTO public.fg_perfil_permiso (perfil_clave, permiso_clave)
SELECT perfil.clave, 'FAREGAS_CERTIFICADO_RECTIFICAR_EJECUTAR'
FROM public.fg_perfil perfil
WHERE perfil.clave = 'SISTEMAS'
ON CONFLICT (perfil_clave, permiso_clave) DO NOTHING;

COMMIT;
