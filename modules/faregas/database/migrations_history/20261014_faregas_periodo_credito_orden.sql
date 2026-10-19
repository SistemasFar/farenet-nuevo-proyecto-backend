-- El período se captura en el paso compartido de Pago, antes de que exista
-- necesariamente un borrador de facturación. Por eso su dueño inicial es la
-- orden de pago. fg_facturacion conserva su fecha_vencimiento histórica.
ALTER TABLE fg_orden_pago
    ADD COLUMN IF NOT EXISTS fecha_inicio_credito date,
    ADD COLUMN IF NOT EXISTS fecha_vencimiento_credito date;

ALTER TABLE fg_orden_pago
    DROP CONSTRAINT IF EXISTS chk_fg_orden_pago_periodo_credito;

-- Compatibilidad para borradores/créditos históricos que ya tenían el
-- vencimiento en facturación. No se modifica ningún pago ni dato de tarjeta.
UPDATE fg_orden_pago op
SET fecha_inicio_credito = COALESCE(
        op.fecha_inicio_credito,
        LEAST(COALESCE(f.fecha_creacion::date, f.fecha_vencimiento), f.fecha_vencimiento)
    ),
    fecha_vencimiento_credito = COALESCE(op.fecha_vencimiento_credito, f.fecha_vencimiento)
FROM fg_facturacion f
WHERE (f.certificado_id = op.certificado_id OR f.operacion_id = op.operacion_id)
  AND LOWER(COALESCE(op.formapago_key, '')) = 'credito'
  AND f.fecha_vencimiento IS NOT NULL
  AND (op.fecha_inicio_credito IS NULL OR op.fecha_vencimiento_credito IS NULL);

ALTER TABLE fg_orden_pago
    ADD CONSTRAINT chk_fg_orden_pago_periodo_credito
    CHECK (
        fecha_inicio_credito IS NULL
        OR fecha_vencimiento_credito IS NULL
        OR fecha_vencimiento_credito >= fecha_inicio_credito
    );

COMMENT ON COLUMN fg_orden_pago.fecha_inicio_credito IS
    'Fecha inicial del período de crédito capturada en el paso Pago.';
COMMENT ON COLUMN fg_orden_pago.fecha_vencimiento_credito IS
    'Fecha final del período de crédito capturada en el paso Pago.';
