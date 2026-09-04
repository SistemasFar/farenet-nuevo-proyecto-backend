-- 20260904_faregas_facturacion_estado_pendiente_sunat.sql

DO $$ 
DECLARE
  constraint_name text;
BEGIN
  SELECT c.conname INTO constraint_name
  FROM pg_constraint c 
  JOIN pg_class t ON c.conrelid = t.oid 
  JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(c.conkey)
  WHERE t.relname = 'fg_facturacion' AND c.contype = 'c' AND a.attname = 'estado'
  LIMIT 1;

  IF constraint_name IS NOT NULL THEN
    EXECUTE 'ALTER TABLE fg_facturacion DROP CONSTRAINT ' || constraint_name;
  END IF;

  ALTER TABLE fg_facturacion 
  ADD CONSTRAINT fg_facturacion_estado_check 
  CHECK (estado IN ('BORRADOR', 'PENDIENTE', 'PENDIENTE_SUNAT', 'ACEPTADO', 'RECHAZADO', 'ERROR', 'ANULADO'));
END $$;
