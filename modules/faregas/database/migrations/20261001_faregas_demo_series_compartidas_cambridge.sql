BEGIN;

-- La cuenta DEMO efectiva de las sedes FAREGAS es CAMBRIDGE. La serie se
-- resuelve por esa cuenta y no por la planta que aloja técnicamente la fila.
-- PRODUCCION queda fuera de todos los predicados de modificación.
LOCK TABLE fg_serie_comprobante IN SHARE ROW EXCLUSIVE MODE;

CREATE TEMP TABLE tmp_fg_series_produccion ON COMMIT DROP AS
SELECT id, md5(row_to_json(s)::text) AS fingerprint
FROM fg_serie_comprobante s
WHERE entorno_emision = 'PRODUCCION';

DO $$
DECLARE
    promociones_auditadas INTEGER;
    historicas_previas INTEGER;
BEGIN
    SELECT COUNT(*) INTO promociones_auditadas
    FROM fg_serie_comprobante s
    JOIN fg_auditoria_config a
      ON a.accion = 'PROMOVER_SERIE_DEMO_A_NUBEFACT'
     AND a.entidad = 'SERIE_COMPROBANTE'
     AND a.identificador = concat_ws(':', s.planta_key, s.tipo_comprobante, s.serie)
    WHERE s.proveedor_emision = 'NUBEFACT'
      AND s.entorno_emision = 'DEMO'
      AND s.sistema_origen = 'FAREGAS_DEMO'
      AND s.serie NOT IN ('FFF1', 'BBB1');

    IF promociones_auditadas NOT IN (0, 166) THEN
        RAISE EXCEPTION
            'Reversión insegura: se esperaban 166 promociones auditadas o 0 si ya fue aplicada; encontradas %.',
            promociones_auditadas;
    END IF;

    SELECT COUNT(*) INTO historicas_previas
    FROM fg_serie_comprobante s
    WHERE s.proveedor_emision = 'NUBEFACT'
      AND s.entorno_emision = 'DEMO'
      AND s.empresa_key = 'CAMBRIDGE'
      AND s.sistema_origen = 'FAREGAS_DEMO'
      AND ((s.tipo_comprobante = 'NOTA_CREDITO_FACTURA' AND s.serie = 'FC03')
        OR (s.tipo_comprobante = 'NOTA_CREDITO_BOLETA' AND s.serie = 'BC03'));

    IF historicas_previas NOT IN (0, 2) THEN
        RAISE EXCEPTION
            'Reversión insegura: se esperaban FC03/BC03 previas o ninguna si ya fue aplicada; encontradas %.',
            historicas_previas;
    END IF;
END $$;

-- Revierte exactamente las promociones registradas por la operación masiva.
UPDATE fg_serie_comprobante s
SET proveedor_emision = 'LEGACY'
FROM fg_auditoria_config a
WHERE a.accion = 'PROMOVER_SERIE_DEMO_A_NUBEFACT'
  AND a.entidad = 'SERIE_COMPROBANTE'
  AND a.identificador = concat_ws(':', s.planta_key, s.tipo_comprobante, s.serie)
  AND s.proveedor_emision = 'NUBEFACT'
  AND s.entorno_emision = 'DEMO'
  AND s.sistema_origen = 'FAREGAS_DEMO'
  AND s.serie NOT IN ('FFF1', 'BBB1');

-- Estas dos filas eran anteriores a la promoción masiva, pero el portal
-- confirmó que FC03/BC03 no son series DEMO autorizadas para CAMBRIDGE.
UPDATE fg_serie_comprobante
SET proveedor_emision = 'LEGACY'
WHERE proveedor_emision = 'NUBEFACT'
  AND entorno_emision = 'DEMO'
  AND empresa_key = 'CAMBRIDGE'
  AND sistema_origen = 'FAREGAS_DEMO'
  AND ((tipo_comprobante = 'NOTA_CREDITO_FACTURA' AND serie = 'FC03')
    OR (tipo_comprobante = 'NOTA_CREDITO_BOLETA' AND serie = 'BC03'));

CREATE TEMP TABLE tmp_fg_demo_contadores (
    tipo_comprobante VARCHAR(30) PRIMARY KEY,
    serie VARCHAR(30) NOT NULL,
    ultimo_numero BIGINT NOT NULL
) ON COMMIT DROP;

INSERT INTO tmp_fg_demo_contadores (tipo_comprobante, serie, ultimo_numero)
WITH objetivos(tipo_comprobante, serie) AS (
    VALUES
        ('FACTURA', 'FFF1'),
        ('NOTA_CREDITO_FACTURA', 'FFF1'),
        ('NOTA_DEBITO_FACTURA', 'FFF1'),
        ('BOLETA', 'BBB1'),
        ('NOTA_CREDITO_BOLETA', 'BBB1'),
        ('NOTA_DEBITO_BOLETA', 'BBB1')
), usados AS (
    SELECT s.tipo_comprobante, upper(s.serie) AS serie, s.ultimo_numero AS numero
    FROM fg_serie_comprobante s
    WHERE s.empresa_key = 'CAMBRIDGE'
      AND s.entorno_emision = 'DEMO'
      AND upper(s.serie) IN ('FFF1', 'BBB1')

    UNION ALL

    SELECT f.tipo_comprobante, upper(f.serie), f.numero
    FROM fg_facturacion f
    WHERE f.empresa_key = 'CAMBRIDGE'
      AND f.entorno_facturador = 'DEMO'
      AND upper(f.serie) IN ('FFF1', 'BBB1')
      AND f.numero IS NOT NULL

    UNION ALL

    SELECT CASE WHEN f.tipo_comprobante = 'FACTURA'
                THEN 'NOTA_CREDITO_FACTURA' ELSE 'NOTA_CREDITO_BOLETA' END,
           upper(c.serie), c.numero
    FROM fg_credito c
    JOIN fg_facturacion f ON f.id = c.facturacion_id
    WHERE c.empresa_key = 'CAMBRIDGE'
      AND upper(c.serie) IN ('FFF1', 'BBB1')
      AND c.numero IS NOT NULL

    UNION ALL

    SELECT CASE WHEN f.tipo_comprobante = 'FACTURA'
                THEN 'NOTA_DEBITO_FACTURA' ELSE 'NOTA_DEBITO_BOLETA' END,
           upper(d.serie), d.numero
    FROM fg_debito d
    JOIN fg_facturacion f ON f.id = d.facturacion_id
    WHERE d.empresa_key = 'CAMBRIDGE'
      AND upper(d.serie) IN ('FFF1', 'BBB1')
      AND d.numero IS NOT NULL

    UNION ALL

    SELECT CASE
             WHEN (o.solicitud->>'tipo_de_comprobante')::integer = 1 THEN 'FACTURA'
             WHEN (o.solicitud->>'tipo_de_comprobante')::integer = 2 THEN 'BOLETA'
             WHEN (o.solicitud->>'tipo_de_comprobante')::integer = 3
              AND (o.solicitud->>'documento_que_se_modifica_tipo')::integer = 1
               THEN 'NOTA_CREDITO_FACTURA'
             WHEN (o.solicitud->>'tipo_de_comprobante')::integer = 3
              AND (o.solicitud->>'documento_que_se_modifica_tipo')::integer = 2
               THEN 'NOTA_CREDITO_BOLETA'
             WHEN (o.solicitud->>'tipo_de_comprobante')::integer = 4
              AND (o.solicitud->>'documento_que_se_modifica_tipo')::integer = 1
               THEN 'NOTA_DEBITO_FACTURA'
             WHEN (o.solicitud->>'tipo_de_comprobante')::integer = 4
              AND (o.solicitud->>'documento_que_se_modifica_tipo')::integer = 2
               THEN 'NOTA_DEBITO_BOLETA'
           END,
           upper(o.solicitud->>'serie'),
           (o.solicitud->>'numero')::bigint
    FROM fg_documento_electronico_operacion o
    WHERE o.operacion = 'EMITIR'
      AND upper(o.solicitud->>'serie') IN ('FFF1', 'BBB1')
      AND COALESCE(o.solicitud->>'numero', '') ~ '^[0-9]+$'
      AND COALESCE(o.solicitud->>'tipo_de_comprobante', '') ~ '^[1-4]$'
)
SELECT obj.tipo_comprobante,
       obj.serie,
       COALESCE(MAX(u.numero), 0)::bigint
FROM objetivos obj
LEFT JOIN usados u
  ON u.tipo_comprobante = obj.tipo_comprobante
 AND u.serie = obj.serie
GROUP BY obj.tipo_comprobante, obj.serie;

INSERT INTO fg_serie_comprobante (
    planta_key, tipo_comprobante, serie, ultimo_numero,
    es_predeterminada, autogenerada, contingencia, activo,
    empresa_key, proveedor_emision, entorno_emision,
    confirmada_produccion, numero_inicial_confirmado, sistema_origen
)
SELECT '201', c.tipo_comprobante, c.serie, c.ultimo_numero,
       TRUE, TRUE, FALSE, TRUE,
       'CAMBRIDGE', 'NUBEFACT', 'DEMO',
       FALSE, NULL, 'NUBEFACT_DEMO_COMPARTIDA'
FROM tmp_fg_demo_contadores c
ON CONFLICT (planta_key, tipo_comprobante, serie) DO UPDATE
SET ultimo_numero = GREATEST(fg_serie_comprobante.ultimo_numero, EXCLUDED.ultimo_numero),
    es_predeterminada = TRUE,
    autogenerada = TRUE,
    contingencia = FALSE,
    activo = TRUE,
    empresa_key = 'CAMBRIDGE',
    proveedor_emision = 'NUBEFACT',
    entorno_emision = 'DEMO',
    confirmada_produccion = FALSE,
    numero_inicial_confirmado = NULL,
    sistema_origen = 'NUBEFACT_DEMO_COMPARTIDA',
    fecha_modificacion = CURRENT_TIMESTAMP;

-- Una cuenta emisora DEMO sólo puede tener una predeterminada por tipo.
CREATE UNIQUE INDEX IF NOT EXISTS uq_fg_serie_nubefact_demo_emisor_tipo
    ON fg_serie_comprobante (empresa_key, tipo_comprobante, entorno_emision)
    WHERE proveedor_emision = 'NUBEFACT'
      AND entorno_emision = 'DEMO'
      AND activo = TRUE
      AND es_predeterminada = TRUE;

DO $$
DECLARE
    filas_demo INTEGER;
BEGIN
    SELECT COUNT(*) INTO filas_demo
    FROM fg_serie_comprobante
    WHERE empresa_key = 'CAMBRIDGE'
      AND proveedor_emision = 'NUBEFACT'
      AND entorno_emision = 'DEMO'
      AND activo = TRUE
      AND es_predeterminada = TRUE
      AND ((tipo_comprobante IN ('FACTURA', 'NOTA_CREDITO_FACTURA', 'NOTA_DEBITO_FACTURA') AND serie = 'FFF1')
        OR (tipo_comprobante IN ('BOLETA', 'NOTA_CREDITO_BOLETA', 'NOTA_DEBITO_BOLETA') AND serie = 'BBB1'));

    IF filas_demo <> 6 THEN
        RAISE EXCEPTION 'Se esperaban 6 contadores DEMO compartidos; encontrados %.', filas_demo;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM fg_serie_comprobante
        WHERE proveedor_emision = 'NUBEFACT'
          AND entorno_emision = 'DEMO'
          AND activo = TRUE
          AND serie NOT IN ('FFF1', 'BBB1')
    ) THEN
        RAISE EXCEPTION 'Persisten series NUBEFACT/DEMO no autorizadas.';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM tmp_fg_series_produccion antes
        FULL JOIN (
            SELECT id, md5(row_to_json(s)::text) AS fingerprint
            FROM fg_serie_comprobante s
            WHERE entorno_emision = 'PRODUCCION'
        ) despues USING (id)
        WHERE antes.id IS NULL
           OR despues.id IS NULL
           OR antes.fingerprint IS DISTINCT FROM despues.fingerprint
    ) THEN
        RAISE EXCEPTION 'La migración alteró series de PRODUCCION; se cancela.';
    END IF;
END $$;

INSERT INTO fg_auditoria_config (
    username, entidad, accion, identificador, detalles, planta_key, ip_direccion
)
SELECT 'gibarra', 'SERIE_COMPROBANTE', 'CONFIGURAR_SERIE_DEMO_COMPARTIDA',
       concat_ws(':', 'CAMBRIDGE', c.tipo_comprobante, c.serie),
       jsonb_build_object(
           'empresaEmisora', 'CAMBRIDGE',
           'entorno', 'DEMO',
           'tipoComprobante', c.tipo_comprobante,
           'serie', c.serie,
           'ultimoNumeroSeguro', c.ultimo_numero,
           'plantaKeyTecnica', '201'
       ),
       '201', '127.0.0.1'
FROM tmp_fg_demo_contadores c
WHERE NOT EXISTS (
    SELECT 1 FROM fg_auditoria_config a
    WHERE a.accion = 'CONFIGURAR_SERIE_DEMO_COMPARTIDA'
      AND a.identificador = concat_ws(':', 'CAMBRIDGE', c.tipo_comprobante, c.serie)
);

COMMIT;
