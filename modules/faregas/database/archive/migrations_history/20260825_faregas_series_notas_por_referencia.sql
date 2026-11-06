BEGIN;

-- Una nota siempre modifica un comprobante previo. Se separa factura/boleta
-- para evitar compartir una serie predeterminada entre documentos distintos.
ALTER TABLE fg_serie_comprobante
    DROP CONSTRAINT IF EXISTS chk_fg_serie_comprobante_tipo;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM fg_serie_comprobante
        WHERE tipo_comprobante IN ('NOTA_CREDITO', 'NOTA_DEBITO')
          AND LEFT(UPPER(BTRIM(serie)), 1) NOT IN ('F', 'B')
    ) THEN
        RAISE EXCEPTION 'Existen series genéricas de nota que no permiten identificar si referencian factura o boleta.';
    END IF;
END $$;

UPDATE fg_serie_comprobante
SET tipo_comprobante = CASE
        WHEN tipo_comprobante = 'NOTA_CREDITO' AND LEFT(UPPER(BTRIM(serie)), 1) = 'F' THEN 'NOTA_CREDITO_FACTURA'
        WHEN tipo_comprobante = 'NOTA_CREDITO' AND LEFT(UPPER(BTRIM(serie)), 1) = 'B' THEN 'NOTA_CREDITO_BOLETA'
        WHEN tipo_comprobante = 'NOTA_DEBITO' AND LEFT(UPPER(BTRIM(serie)), 1) = 'F' THEN 'NOTA_DEBITO_FACTURA'
        WHEN tipo_comprobante = 'NOTA_DEBITO' AND LEFT(UPPER(BTRIM(serie)), 1) = 'B' THEN 'NOTA_DEBITO_BOLETA'
        ELSE tipo_comprobante
    END,
    fecha_modificacion = CURRENT_TIMESTAMP
WHERE tipo_comprobante IN ('NOTA_CREDITO', 'NOTA_DEBITO');

ALTER TABLE fg_serie_comprobante
    ADD CONSTRAINT chk_fg_serie_comprobante_tipo
    CHECK (tipo_comprobante IN (
        'FACTURA',
        'BOLETA',
        'NOTA_CREDITO_FACTURA',
        'NOTA_CREDITO_BOLETA',
        'NOTA_DEBITO_FACTURA',
        'NOTA_DEBITO_BOLETA'
    ));

-- Se copian los correlativos históricos de crédito como configuración
-- administrativa. La tabla productiva seriedocumentobase permanece intacta.
INSERT INTO fg_serie_comprobante (
    planta_key, tipo_comprobante, serie, ultimo_numero,
    es_predeterminada, autogenerada, contingencia, activo
)
SELECT s.planta_key, 'NOTA_CREDITO_FACTURA', UPPER(BTRIM(s.serienotacreditofactura)),
       s.nroactualnotacreditofactura, TRUE, TRUE, FALSE, TRUE
FROM seriedocumentobase s
JOIN fg_planta p ON p.key = s.planta_key
WHERE COALESCE(s.estado, TRUE) = TRUE
  AND UPPER(BTRIM(COALESCE(s.serienotacreditofactura, ''))) ~ '^FC[0-9A-Z]{2}$'
  AND NOT EXISTS (
      SELECT 1 FROM seriedocumentobase otra
      WHERE otra.planta_key = s.planta_key
        AND COALESCE(otra.estado, TRUE) = TRUE
        AND otra.id <> s.id
  )
  AND NOT EXISTS (
      SELECT 1 FROM fg_serie_comprobante actual
      WHERE actual.planta_key = s.planta_key
        AND actual.tipo_comprobante = 'NOTA_CREDITO_FACTURA'
        AND actual.activo = TRUE
        AND actual.es_predeterminada = TRUE
  )
ON CONFLICT (planta_key, tipo_comprobante, serie) DO NOTHING;

INSERT INTO fg_serie_comprobante (
    planta_key, tipo_comprobante, serie, ultimo_numero,
    es_predeterminada, autogenerada, contingencia, activo
)
SELECT s.planta_key, 'NOTA_CREDITO_BOLETA', UPPER(BTRIM(s.serienotacreditoboleta)),
       s.nroactualnotacreditoboleta, TRUE, TRUE, FALSE, TRUE
FROM seriedocumentobase s
JOIN fg_planta p ON p.key = s.planta_key
WHERE COALESCE(s.estado, TRUE) = TRUE
  AND UPPER(BTRIM(COALESCE(s.serienotacreditoboleta, ''))) ~ '^BC[0-9A-Z]{2}$'
  AND NOT EXISTS (
      SELECT 1 FROM seriedocumentobase otra
      WHERE otra.planta_key = s.planta_key
        AND COALESCE(otra.estado, TRUE) = TRUE
        AND otra.id <> s.id
  )
  AND NOT EXISTS (
      SELECT 1 FROM fg_serie_comprobante actual
      WHERE actual.planta_key = s.planta_key
        AND actual.tipo_comprobante = 'NOTA_CREDITO_BOLETA'
        AND actual.activo = TRUE
        AND actual.es_predeterminada = TRUE
  )
ON CONFLICT (planta_key, tipo_comprobante, serie) DO NOTHING;

-- El legacy no posee columnas de débito. Se preparan series administrativas
-- equivalentes FDxx/BDxx desde cero, sin reservar ni emitir numeración real.
INSERT INTO fg_serie_comprobante (
    planta_key, tipo_comprobante, serie, ultimo_numero,
    es_predeterminada, autogenerada, contingencia, activo
)
SELECT s.planta_key, 'NOTA_DEBITO_FACTURA',
       'FD' || RIGHT(UPPER(BTRIM(s.serienotacreditofactura)), 2),
       0, TRUE, TRUE, FALSE, TRUE
FROM seriedocumentobase s
JOIN fg_planta p ON p.key = s.planta_key
WHERE COALESCE(s.estado, TRUE) = TRUE
  AND UPPER(BTRIM(COALESCE(s.serienotacreditofactura, ''))) ~ '^FC[0-9A-Z]{2}$'
  AND NOT EXISTS (
      SELECT 1 FROM seriedocumentobase otra
      WHERE otra.planta_key = s.planta_key
        AND COALESCE(otra.estado, TRUE) = TRUE
        AND otra.id <> s.id
  )
  AND NOT EXISTS (
      SELECT 1 FROM fg_serie_comprobante actual
      WHERE actual.planta_key = s.planta_key
        AND actual.tipo_comprobante = 'NOTA_DEBITO_FACTURA'
        AND actual.activo = TRUE
        AND actual.es_predeterminada = TRUE
  )
ON CONFLICT (planta_key, tipo_comprobante, serie) DO NOTHING;

INSERT INTO fg_serie_comprobante (
    planta_key, tipo_comprobante, serie, ultimo_numero,
    es_predeterminada, autogenerada, contingencia, activo
)
SELECT s.planta_key, 'NOTA_DEBITO_BOLETA',
       'BD' || RIGHT(UPPER(BTRIM(s.serienotacreditoboleta)), 2),
       0, TRUE, TRUE, FALSE, TRUE
FROM seriedocumentobase s
JOIN fg_planta p ON p.key = s.planta_key
WHERE COALESCE(s.estado, TRUE) = TRUE
  AND UPPER(BTRIM(COALESCE(s.serienotacreditoboleta, ''))) ~ '^BC[0-9A-Z]{2}$'
  AND NOT EXISTS (
      SELECT 1 FROM seriedocumentobase otra
      WHERE otra.planta_key = s.planta_key
        AND COALESCE(otra.estado, TRUE) = TRUE
        AND otra.id <> s.id
  )
  AND NOT EXISTS (
      SELECT 1 FROM fg_serie_comprobante actual
      WHERE actual.planta_key = s.planta_key
        AND actual.tipo_comprobante = 'NOTA_DEBITO_BOLETA'
        AND actual.activo = TRUE
        AND actual.es_predeterminada = TRUE
  )
ON CONFLICT (planta_key, tipo_comprobante, serie) DO NOTHING;

COMMIT;
