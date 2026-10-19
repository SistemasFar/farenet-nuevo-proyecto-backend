BEGIN;

-- Promueve únicamente la fotografía DMS de Independencia a series Nubefact
-- preparadas. No confirma el corte ni avanza ningún correlativo. La emisión
-- productiva seguirá bloqueada hasta registrar el número final y fecha de corte.
DO $$
DECLARE
    filas INTEGER;
BEGIN
    SELECT COUNT(*) INTO filas
    FROM fg_serie_comprobante
    WHERE planta_key = '201'
      AND entorno_emision = 'PRODUCCION'
      AND activo = TRUE
      AND ((tipo_comprobante = 'FACTURA' AND serie = 'F015')
        OR (tipo_comprobante = 'BOLETA' AND serie = 'B015'));

    IF filas <> 2 THEN
        RAISE EXCEPTION 'Se esperaban exactamente F015 y B015 para Independencia; se encontraron % filas.', filas;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM fg_serie_comprobante
        WHERE planta_key = '201'
          AND entorno_emision = 'PRODUCCION'
          AND proveedor_emision = 'NUBEFACT'
          AND activo = TRUE
          AND es_predeterminada = TRUE
          AND serie NOT IN ('F015', 'B015')
    ) THEN
        RAISE EXCEPTION 'Independencia ya tiene otra serie Nubefact productiva predeterminada.';
    END IF;
END $$;

UPDATE fg_serie_comprobante
SET empresa_key = 'FAREGAS',
    proveedor_emision = 'NUBEFACT',
    es_predeterminada = TRUE,
    confirmada_produccion = CASE
        WHEN proveedor_emision = 'NUBEFACT' THEN confirmada_produccion
        ELSE FALSE
    END,
    numero_inicial_confirmado = CASE
        WHEN proveedor_emision = 'NUBEFACT' THEN numero_inicial_confirmado
        ELSE NULL
    END,
    sistema_origen = 'DMS_FACT',
    fecha_corte = CASE WHEN proveedor_emision = 'NUBEFACT' THEN fecha_corte ELSE NULL END,
    usuario_confirmacion = CASE WHEN proveedor_emision = 'NUBEFACT' THEN usuario_confirmacion ELSE NULL END,
    fecha_confirmacion = CASE WHEN proveedor_emision = 'NUBEFACT' THEN fecha_confirmacion ELSE NULL END,
    fecha_modificacion = CURRENT_TIMESTAMP
WHERE planta_key = '201'
  AND entorno_emision = 'PRODUCCION'
  AND activo = TRUE
  AND ((tipo_comprobante = 'FACTURA' AND serie = 'F015')
    OR (tipo_comprobante = 'BOLETA' AND serie = 'B015'))
  AND (
      empresa_key IS DISTINCT FROM 'FAREGAS'
      OR proveedor_emision IS DISTINCT FROM 'NUBEFACT'
      OR es_predeterminada IS DISTINCT FROM TRUE
      OR sistema_origen IS DISTINCT FROM 'DMS_FACT'
  );

COMMIT;
