BEGIN;

-- La identidad tributaria de un comprobante incluye al emisor y al ambiente.
-- Esta restricción se crea antes de retirar índices legacy: si existen datos
-- duplicados, PostgreSQL aborta la transacción y conserva todas las garantías.
DO $$
DECLARE
    definicion TEXT;
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint
         WHERE conrelid = 'fg_facturacion'::regclass
           AND conname = 'uq_fg_facturacion_emisor_serie_numero'
           AND contype = 'u'
    ) THEN
        ALTER TABLE fg_facturacion
            ADD CONSTRAINT uq_fg_facturacion_emisor_serie_numero
            UNIQUE (ruc_emisor, entorno_facturador, tipo_comprobante, serie, numero);
    END IF;

    SELECT pg_get_constraintdef(oid)
      INTO definicion
      FROM pg_constraint
     WHERE conrelid = 'fg_facturacion'::regclass
       AND conname = 'uq_fg_facturacion_emisor_serie_numero'
       AND contype = 'u';

    IF definicion IS NULL OR definicion NOT LIKE
       'UNIQUE (ruc_emisor, entorno_facturador, tipo_comprobante, serie, numero)%' THEN
        RAISE EXCEPTION
            'La restricción uq_fg_facturacion_emisor_serie_numero no tiene la definición tributaria esperada: %',
            COALESCE(definicion, '<ausente>');
    END IF;

    -- Estos índices omiten entorno_facturador (y uno también ruc_emisor), por lo
    -- que bloquean series/números válidos cuando DEMO y PRODUCCIÓN se separan.
    DROP INDEX IF EXISTS uq_fg_facturacion_comprobante_tributario;
    DROP INDEX IF EXISTS uq_fg_facturacion_empresa_serie_numero;

    -- Compatibilidad con instalaciones antiguas que aún conservan UNIQUE(serie, numero).
    ALTER TABLE fg_facturacion
        DROP CONSTRAINT IF EXISTS uq_fg_facturacion_serie_numero;
END $$;

COMMIT;
