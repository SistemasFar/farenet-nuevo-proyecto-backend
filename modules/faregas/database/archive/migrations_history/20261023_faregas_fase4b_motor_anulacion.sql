BEGIN;

-- FAREGAS Fase 4B: Motor de anulación total autorizada
-- Adiciona campos de auditoría, idempotencia y seguimiento de ejecución
-- en fg_solicitud_operacion. No ejecuta anulaciones reales ni altera cobros.
ALTER TABLE public.fg_solicitud_operacion
    ADD COLUMN IF NOT EXISTS usuario_ejecucion varchar(255),
    ADD COLUMN IF NOT EXISTS fecha_ejecucion timestamptz,
    ADD COLUMN IF NOT EXISTS idempotencia_ejecucion uuid;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_fg_solicitud_ejecutor'
    ) THEN
        ALTER TABLE public.fg_solicitud_operacion
            ADD CONSTRAINT fk_fg_solicitud_ejecutor
            FOREIGN KEY (usuario_ejecucion) REFERENCES public.fg_usuario(username) ON DELETE RESTRICT;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ck_fg_solicitud_no_autoejecucion'
    ) THEN
        ALTER TABLE public.fg_solicitud_operacion
            ADD CONSTRAINT ck_fg_solicitud_no_autoejecucion
            CHECK (usuario_ejecucion IS NULL OR usuario_ejecucion IS DISTINCT FROM usuario_solicitante);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_fg_solicitud_ejecutor
    ON public.fg_solicitud_operacion (usuario_ejecucion, fecha_ejecucion DESC)
    WHERE usuario_ejecucion IS NOT NULL;

COMMIT;
