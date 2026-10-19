BEGIN;

-- Desacoplar certificado_id de fg_orden_pago
ALTER TABLE fg_orden_pago ALTER COLUMN certificado_id DROP NOT NULL;

-- Desacoplar certificado_id de fg_facturacion
ALTER TABLE fg_facturacion ALTER COLUMN certificado_id DROP NOT NULL;

-- Eliminar las restricciones UNIQUE actuales que fuerzan certificado_id
ALTER TABLE fg_orden_pago DROP CONSTRAINT IF EXISTS uq_fg_orden_pago_certificado;
ALTER TABLE fg_facturacion DROP CONSTRAINT IF EXISTS fg_facturacion_certificado_id_key;
ALTER TABLE fg_facturacion DROP CONSTRAINT IF EXISTS uq_fg_facturacion_certificado;

-- Crear índices UNIQUE parciales que solo aplican cuando certificado_id NO ES NULL
CREATE UNIQUE INDEX IF NOT EXISTS uq_fg_orden_pago_certificado_partial ON fg_orden_pago (certificado_id) WHERE certificado_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_fg_facturacion_certificado_partial ON fg_facturacion (certificado_id) WHERE certificado_id IS NOT NULL;

COMMIT;
