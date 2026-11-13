-- Migración 002: Ampliación de Auditoría Integral FAREGAS
-- Fecha: 2026-11-13
-- Idempotente y compatible con PostgreSQL 13+

BEGIN;

-- 1. Ampliar longitud de columnas existentes
ALTER TABLE public.fg_auditoria_acceso ALTER COLUMN categoria TYPE character varying(50);
ALTER TABLE public.fg_auditoria_acceso ALTER COLUMN evento TYPE character varying(100);

-- 2. Agregar nuevas columnas de auditoría detallada
ALTER TABLE public.fg_auditoria_acceso ADD COLUMN IF NOT EXISTS usuario_id bigint;
ALTER TABLE public.fg_auditoria_acceso ADD COLUMN IF NOT EXISTS modulo character varying(50);
ALTER TABLE public.fg_auditoria_acceso ADD COLUMN IF NOT EXISTS resultado character varying(20) DEFAULT 'EXITO' NOT NULL;
ALTER TABLE public.fg_auditoria_acceso ADD COLUMN IF NOT EXISTS motivo_error text;
ALTER TABLE public.fg_auditoria_acceso ADD COLUMN IF NOT EXISTS documento_referencia character varying(100);
ALTER TABLE public.fg_auditoria_acceso ADD COLUMN IF NOT EXISTS es_automatico boolean DEFAULT false NOT NULL;
ALTER TABLE public.fg_auditoria_acceso ADD COLUMN IF NOT EXISTS correlacion_id character varying(100);
ALTER TABLE public.fg_auditoria_acceso ADD COLUMN IF NOT EXISTS datos_previos jsonb;
ALTER TABLE public.fg_auditoria_acceso ADD COLUMN IF NOT EXISTS datos_nuevos jsonb;

-- 3. Índices para optimizar consultas por módulo, documento y resultado
CREATE INDEX IF NOT EXISTS idx_fg_auditoria_modulo_fecha ON public.fg_auditoria_acceso USING btree (modulo, fecha_evento DESC);
CREATE INDEX IF NOT EXISTS idx_fg_auditoria_resultado ON public.fg_auditoria_acceso USING btree (resultado);
CREATE INDEX IF NOT EXISTS idx_fg_auditoria_doc_ref ON public.fg_auditoria_acceso USING btree (documento_referencia);

-- 4. Comentarios descriptivos
COMMENT ON COLUMN public.fg_auditoria_acceso.usuario_id IS 'ID del usuario en fg_usuario que ejecutó la acción';
COMMENT ON COLUMN public.fg_auditoria_acceso.modulo IS 'Módulo funcional de FAREGAS (CERTIFICADOS, FACTURACION, PAGOS, etc.)';
COMMENT ON COLUMN public.fg_auditoria_acceso.resultado IS 'Resultado del evento: EXITO, ERROR, RECHAZADO, ADVERTENCIA';
COMMENT ON COLUMN public.fg_auditoria_acceso.motivo_error IS 'Descripción técnica o mensaje de error en caso de fallo';
COMMENT ON COLUMN public.fg_auditoria_acceso.documento_referencia IS 'Identificador visible del documento: serie-correlativo, placa, o clave';
COMMENT ON COLUMN public.fg_auditoria_acceso.es_automatico IS 'Indica si la acción fue generada por worker/cron job o por usuario humano';
COMMENT ON COLUMN public.fg_auditoria_acceso.correlacion_id IS 'Identificador de correlación o sesión para trazabilidad distribuida';
COMMENT ON COLUMN public.fg_auditoria_acceso.datos_previos IS 'Snapshot de los valores auditables antes de la modificación';
COMMENT ON COLUMN public.fg_auditoria_acceso.datos_nuevos IS 'Snapshot de los valores auditables después de la modificación';

COMMIT;

