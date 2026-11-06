-- ============================================================================
-- MIGRACIÓN FAREGAS — FASE 2: SOPORTE ESTRUCTURADO PARA DETRACCIÓN Y GRATUIDAD
-- Nombre: 20261016_faregas_facturacion_fase2_detraccion_gratuidad.sql
-- Propósito: Ampliar fg_facturacion para soportar de manera nativa e idempotente
--            operaciones sujetas a detracción SPOT y operaciones a título gratuito
--            según normativa SUNAT y NubeFact, preservando registros históricos.
-- ============================================================================

DO $$
BEGIN
    -- 1. Campos para Detracciones (SPOT SUNAT)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'fg_facturacion' AND column_name = 'es_detraccion'
    ) THEN
        ALTER TABLE fg_facturacion ADD COLUMN es_detraccion BOOLEAN NOT NULL DEFAULT FALSE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'fg_facturacion' AND column_name = 'detraccion_tipo'
    ) THEN
        ALTER TABLE fg_facturacion ADD COLUMN detraccion_tipo VARCHAR(10) NULL;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'fg_facturacion' AND column_name = 'detraccion_porcentaje'
    ) THEN
        ALTER TABLE fg_facturacion ADD COLUMN detraccion_porcentaje NUMERIC(5,2) NULL;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'fg_facturacion' AND column_name = 'detraccion_total'
    ) THEN
        ALTER TABLE fg_facturacion ADD COLUMN detraccion_total NUMERIC(12,2) NULL;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'fg_facturacion' AND column_name = 'detraccion_medio_pago'
    ) THEN
        ALTER TABLE fg_facturacion ADD COLUMN detraccion_medio_pago VARCHAR(10) NULL DEFAULT '001';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'fg_facturacion' AND column_name = 'detraccion_cuenta_banco'
    ) THEN
        ALTER TABLE fg_facturacion ADD COLUMN detraccion_cuenta_banco VARCHAR(50) NULL;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'fg_facturacion' AND column_name = 'monto_neto_pendiente'
    ) THEN
        ALTER TABLE fg_facturacion ADD COLUMN monto_neto_pendiente NUMERIC(12,2) NULL;
    END IF;

    -- 2. Campos para Operaciones Gratuitas y Desgloses Tributarios Adicionales
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'fg_facturacion' AND column_name = 'total_gratuito'
    ) THEN
        ALTER TABLE fg_facturacion ADD COLUMN total_gratuito NUMERIC(12,2) NOT NULL DEFAULT 0.00;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'fg_facturacion' AND column_name = 'total_gravado'
    ) THEN
        ALTER TABLE fg_facturacion ADD COLUMN total_gravado NUMERIC(12,2) NULL;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'fg_facturacion' AND column_name = 'total_inafecto'
    ) THEN
        ALTER TABLE fg_facturacion ADD COLUMN total_inafecto NUMERIC(12,2) NOT NULL DEFAULT 0.00;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'fg_facturacion' AND column_name = 'total_exonerado'
    ) THEN
        ALTER TABLE fg_facturacion ADD COLUMN total_exonerado NUMERIC(12,2) NOT NULL DEFAULT 0.00;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'fg_facturacion' AND column_name = 'tipo_operacion'
    ) THEN
        ALTER TABLE fg_facturacion ADD COLUMN tipo_operacion VARCHAR(30) NOT NULL DEFAULT 'VENTA_INTERNA';
    END IF;

    -- 3. Restricciones defensivas
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ck_fg_facturacion_detraccion_porcentaje'
    ) THEN
        ALTER TABLE fg_facturacion ADD CONSTRAINT ck_fg_facturacion_detraccion_porcentaje
            CHECK (detraccion_porcentaje IS NULL OR (detraccion_porcentaje >= 0 AND detraccion_porcentaje <= 100));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ck_fg_facturacion_detraccion_total'
    ) THEN
        ALTER TABLE fg_facturacion ADD CONSTRAINT ck_fg_facturacion_detraccion_total
            CHECK (detraccion_total IS NULL OR detraccion_total >= 0);
    END IF;

    -- 4. Cuenta corriente de detracciones del Banco de la Nación en fg_empresa
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'fg_empresa' AND column_name = 'cuenta_detracciones_bn'
    ) THEN
        ALTER TABLE fg_empresa ADD COLUMN cuenta_detracciones_bn VARCHAR(30) NULL;
    END IF;

END $$;
