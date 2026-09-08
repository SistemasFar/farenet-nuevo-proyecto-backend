BEGIN;

-- Corrección respaldada por comprobantes DMS productivos aceptados:
-- FE15-00000931..933 y BE15-00004087..4095.
-- Conserva la fotografía posterior del export de series (934 / 4098), no
-- confirma el cutover y no reserva ni incrementa correlativos.
DO $$
DECLARE
    factura_actual RECORD;
    boleta_actual RECORD;
BEGIN
    SELECT id, serie, ultimo_numero, confirmada_produccion, fecha_corte
      INTO factura_actual
    FROM fg_serie_comprobante
    WHERE planta_key = '201'
      AND tipo_comprobante = 'FACTURA'
      AND proveedor_emision = 'NUBEFACT'
      AND entorno_emision = 'PRODUCCION'
      AND activo = TRUE
      AND es_predeterminada = TRUE
    FOR UPDATE;

    SELECT id, serie, ultimo_numero, confirmada_produccion, fecha_corte
      INTO boleta_actual
    FROM fg_serie_comprobante
    WHERE planta_key = '201'
      AND tipo_comprobante = 'BOLETA'
      AND proveedor_emision = 'NUBEFACT'
      AND entorno_emision = 'PRODUCCION'
      AND activo = TRUE
      AND es_predeterminada = TRUE
    FOR UPDATE;

    IF factura_actual.id IS NULL OR boleta_actual.id IS NULL THEN
        RAISE EXCEPTION 'Independencia no tiene exactamente las series Nubefact productivas preparadas.';
    END IF;
    IF factura_actual.serie NOT IN ('F015', 'FE15') OR factura_actual.ultimo_numero <> 934 THEN
        RAISE EXCEPTION 'Serie/correlativo de factura inesperado: % / %.', factura_actual.serie, factura_actual.ultimo_numero;
    END IF;
    IF boleta_actual.serie NOT IN ('B015', 'BE15') OR boleta_actual.ultimo_numero <> 4098 THEN
        RAISE EXCEPTION 'Serie/correlativo de boleta inesperado: % / %.', boleta_actual.serie, boleta_actual.ultimo_numero;
    END IF;
    IF factura_actual.confirmada_produccion OR boleta_actual.confirmada_produccion
       OR factura_actual.fecha_corte IS NOT NULL OR boleta_actual.fecha_corte IS NOT NULL THEN
        RAISE EXCEPTION 'No se corrigen series después de confirmar el cutover productivo.';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM fg_serie_comprobante
        WHERE planta_key = '201'
          AND tipo_comprobante = 'FACTURA'
          AND serie = 'FE15'
          AND id <> factura_actual.id
    ) THEN
        RAISE EXCEPTION 'Ya existe otra serie FE15 para Independencia.';
    END IF;
    IF EXISTS (
        SELECT 1
        FROM fg_serie_comprobante
        WHERE planta_key = '201'
          AND tipo_comprobante = 'BOLETA'
          AND serie = 'BE15'
          AND id <> boleta_actual.id
    ) THEN
        RAISE EXCEPTION 'Ya existe otra serie BE15 para Independencia.';
    END IF;

    UPDATE fg_serie_comprobante
    SET serie = 'FE15', fecha_modificacion = CURRENT_TIMESTAMP
    WHERE id = factura_actual.id AND serie = 'F015';

    UPDATE fg_serie_comprobante
    SET serie = 'BE15', fecha_modificacion = CURRENT_TIMESTAMP
    WHERE id = boleta_actual.id AND serie = 'B015';
END $$;

COMMIT;
