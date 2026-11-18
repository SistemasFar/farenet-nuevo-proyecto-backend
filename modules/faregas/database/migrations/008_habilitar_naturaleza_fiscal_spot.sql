-- ============================================================================
-- MIGRACIÓN INCREMENTAL: 008_habilitar_naturaleza_fiscal_spot.sql
-- Sistema: FAREGAS
-- Objetivo: Añadir la columna 'naturaleza_spot' a la tabla 'fg_producto_facturacion'
--           para permitir clasificar un producto comercial como Bien o Servicio
--           en el régimen de detracciones (SPOT) de SUNAT (ej. Certificados como Servicio código 037).
-- Idempotencia: 100% seguro para re-ejecución sin duplicados ni pérdida de datos.
-- ============================================================================

BEGIN;

-- 1. Añadir columna naturaleza_spot (BIEN / SERVICIO) a fg_producto_facturacion
ALTER TABLE public.fg_producto_facturacion
    ADD COLUMN IF NOT EXISTS naturaleza_spot character varying(20);

-- 2. Restricción de verificación (CHECK) para asegurar integridad de valores permitidos
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'chk_fg_producto_facturacion_naturaleza_spot'
    ) THEN
        ALTER TABLE public.fg_producto_facturacion
            ADD CONSTRAINT chk_fg_producto_facturacion_naturaleza_spot
            CHECK (naturaleza_spot IS NULL OR naturaleza_spot IN ('BIEN', 'SERVICIO'));
    END IF;
END $$;

-- 3. Comentario explicativo en la columna
COMMENT ON COLUMN public.fg_producto_facturacion.naturaleza_spot IS 
    'Naturaleza fiscal según SUNAT SPOT: BIEN o SERVICIO. Permite que productos comerciales tributen como servicios bajo código 037 (12%).';

COMMIT;

