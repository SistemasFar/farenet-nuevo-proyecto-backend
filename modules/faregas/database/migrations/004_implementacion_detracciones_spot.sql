-- ============================================================================
-- MIGRACIÓN INCREMENTAL: 004_implementacion_detracciones_spot.sql
-- Sistema: FAREGAS
-- Objetivo: Añadir soporte para el Sistema de Pago de Obligaciones Tributarias
--           (SPOT / Detracciones SUNAT) en comprobantes, notas de crédito y catálogos.
-- Idempotencia: 100% seguro para re-ejecución sin duplicados ni pérdida de datos.
-- ============================================================================

BEGIN;

-- 1. Campos en fg_facturacion para Detracciones SPOT
ALTER TABLE public.fg_facturacion
    ADD COLUMN IF NOT EXISTS sujeto_detraccion boolean DEFAULT false,
    ADD COLUMN IF NOT EXISTS detraccion_codigo varchar(10),
    ADD COLUMN IF NOT EXISTS detraccion_descripcion varchar(255),
    ADD COLUMN IF NOT EXISTS detraccion_porcentaje numeric(5,2),
    ADD COLUMN IF NOT EXISTS detraccion_base numeric(12,2),
    ADD COLUMN IF NOT EXISTS detraccion_monto numeric(12,2),
    ADD COLUMN IF NOT EXISTS detraccion_neto numeric(12,2),
    ADD COLUMN IF NOT EXISTS detraccion_estado_deposito varchar(30) DEFAULT 'NO_APLICA',
    ADD COLUMN IF NOT EXISTS detraccion_constancia_nro varchar(50),
    ADD COLUMN IF NOT EXISTS detraccion_constancia_fecha date,
    ADD COLUMN IF NOT EXISTS detraccion_motivo_exclusion varchar(150);

-- 2. Campos en fg_credito (Notas de Crédito)
ALTER TABLE public.fg_credito
    ADD COLUMN IF NOT EXISTS sujeto_detraccion boolean DEFAULT false,
    ADD COLUMN IF NOT EXISTS detraccion_codigo varchar(10),
    ADD COLUMN IF NOT EXISTS detraccion_porcentaje numeric(5,2),
    ADD COLUMN IF NOT EXISTS detraccion_monto numeric(12,2),
    ADD COLUMN IF NOT EXISTS detraccion_neto numeric(12,2),
    ADD COLUMN IF NOT EXISTS detraccion_motivo_exclusion varchar(150);

-- 3. Campos de configuración SPOT en fg_servicio
ALTER TABLE public.fg_servicio
    ADD COLUMN IF NOT EXISTS sujeto_detraccion boolean DEFAULT true,
    ADD COLUMN IF NOT EXISTS detraccion_codigo varchar(10) DEFAULT '037',
    ADD COLUMN IF NOT EXISTS detraccion_porcentaje numeric(5,2) DEFAULT 12.00;

-- 4. Campos de configuración SPOT en fg_producto_facturacion
ALTER TABLE public.fg_producto_facturacion
    ADD COLUMN IF NOT EXISTS sujeto_detraccion boolean DEFAULT false,
    ADD COLUMN IF NOT EXISTS detraccion_codigo varchar(10),
    ADD COLUMN IF NOT EXISTS detraccion_porcentaje numeric(5,2);

-- 5. Índices para optimizar reportes y búsquedas de comprobantes con detracción
CREATE INDEX IF NOT EXISTS idx_fg_facturacion_detraccion 
    ON public.fg_facturacion (sujeto_detraccion, detraccion_estado_deposito)
    WHERE sujeto_detraccion = true;

CREATE INDEX IF NOT EXISTS idx_fg_facturacion_detraccion_constancia
    ON public.fg_facturacion (detraccion_constancia_nro)
    WHERE detraccion_constancia_nro IS NOT NULL;

-- 6. Configurar valores por defecto en servicios existentes (sin alterar precios ni tarifas)
UPDATE public.fg_servicio
SET sujeto_detraccion = true,
    detraccion_codigo = CASE 
        WHEN familia = 'TALLER' THEN '020'
        ELSE '037'
    END,
    detraccion_porcentaje = 12.00
WHERE sujeto_detraccion IS NULL OR detraccion_codigo IS NULL;

-- 7. Configurar productos inventariables/chips como NO sujetos a detracción
UPDATE public.fg_producto_facturacion
SET sujeto_detraccion = false
WHERE sujeto_detraccion IS NULL;

COMMIT;

