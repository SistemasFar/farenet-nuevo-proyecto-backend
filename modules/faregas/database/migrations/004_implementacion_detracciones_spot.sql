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
    ADD COLUMN IF NOT EXISTS sujeto_detraccion boolean,
    ADD COLUMN IF NOT EXISTS detraccion_codigo varchar(10),
    ADD COLUMN IF NOT EXISTS detraccion_descripcion varchar(255),
    ADD COLUMN IF NOT EXISTS detraccion_porcentaje numeric(5,2),
    ADD COLUMN IF NOT EXISTS detraccion_base numeric(12,2),
    ADD COLUMN IF NOT EXISTS detraccion_monto numeric(12,2),
    ADD COLUMN IF NOT EXISTS detraccion_neto numeric(12,2),
    ADD COLUMN IF NOT EXISTS detraccion_estado_deposito varchar(30),
    ADD COLUMN IF NOT EXISTS detraccion_constancia_nro varchar(50),
    ADD COLUMN IF NOT EXISTS detraccion_constancia_fecha date,
    ADD COLUMN IF NOT EXISTS detraccion_motivo_exclusion varchar(150);

-- 2. Campos en fg_credito (Notas de Crédito)
ALTER TABLE public.fg_credito
    ADD COLUMN IF NOT EXISTS sujeto_detraccion boolean,
    ADD COLUMN IF NOT EXISTS detraccion_codigo varchar(10),
    ADD COLUMN IF NOT EXISTS detraccion_descripcion varchar(255),
    ADD COLUMN IF NOT EXISTS detraccion_porcentaje numeric(5,2),
    ADD COLUMN IF NOT EXISTS detraccion_base numeric(12,2),
    ADD COLUMN IF NOT EXISTS detraccion_monto numeric(12,2),
    ADD COLUMN IF NOT EXISTS detraccion_neto numeric(12,2),
    ADD COLUMN IF NOT EXISTS detraccion_estado_deposito varchar(30),
    ADD COLUMN IF NOT EXISTS detraccion_constancia_nro varchar(50),
    ADD COLUMN IF NOT EXISTS detraccion_constancia_fecha date,
    ADD COLUMN IF NOT EXISTS detraccion_motivo_exclusion varchar(150);

-- 3. Campos de configuración SPOT en fg_servicio
ALTER TABLE public.fg_servicio
    ADD COLUMN IF NOT EXISTS sujeto_detraccion boolean,
    ADD COLUMN IF NOT EXISTS detraccion_codigo varchar(10),
    ADD COLUMN IF NOT EXISTS detraccion_porcentaje numeric(5,2);

-- 4. Campos de configuración SPOT en fg_producto_facturacion
ALTER TABLE public.fg_producto_facturacion
    ADD COLUMN IF NOT EXISTS sujeto_detraccion boolean,
    ADD COLUMN IF NOT EXISTS detraccion_codigo varchar(10),
    ADD COLUMN IF NOT EXISTS detraccion_porcentaje numeric(5,2);

-- 5. Índices para optimizar reportes y búsquedas de comprobantes con detracción
CREATE INDEX IF NOT EXISTS idx_fg_facturacion_detraccion 
    ON public.fg_facturacion (sujeto_detraccion, detraccion_estado_deposito)
    WHERE sujeto_detraccion = true;

CREATE INDEX IF NOT EXISTS idx_fg_facturacion_detraccion_constancia
    ON public.fg_facturacion (detraccion_constancia_nro)
    WHERE detraccion_constancia_nro IS NOT NULL;

-- 6. No se presume una clasificación SPOT para servicios o productos.
-- NULL significa "pendiente de clasificación tributaria"; configurar cada
-- servicio contra el Anexo aplicable antes de emitir una factura > S/ 700.

COMMIT;

