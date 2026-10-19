BEGIN;

ALTER TABLE fg_certificado
    DROP CONSTRAINT IF EXISTS ck_fg_certificado_paso_actual;

-- Los borradores anteriores sin evidencia de pago deben abrir el nuevo primer
-- paso operativo: Pago. Los que ya avanzaron conservan su progreso.
UPDATE fg_certificado c
SET paso_actual = 'PAGO'
WHERE c.estado = 'BORRADOR'
  AND c.paso_actual = 'VEHICULO'
  AND NOT EXISTS (
      SELECT 1 FROM fg_orden_pago op WHERE op.certificado_id = c.id
  );

ALTER TABLE fg_certificado
    ALTER COLUMN paso_actual SET DEFAULT 'DATOS_INICIALES';

ALTER TABLE fg_certificado
    ADD CONSTRAINT ck_fg_certificado_paso_actual
    CHECK (paso_actual IN (
        'DATOS_INICIALES',
        'PAGO',
        'VEHICULO',
        'FACTURACION',
        'PREVISUALIZACION',
        'VERIFICACION_EMISION'
    ));

COMMIT;
