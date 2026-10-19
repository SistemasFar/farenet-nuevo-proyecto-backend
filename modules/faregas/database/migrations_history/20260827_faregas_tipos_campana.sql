-- Catálogo definitivo de tipos de campaña FAREGAS.
-- Conserva los registros anteriores y traslada la restricción por placa al código.

ALTER TABLE fg_descuento
    DROP CONSTRAINT IF EXISTS chk_fg_descuento_tipo;

UPDATE fg_descuento
SET tipo = CASE tipo
    WHEN 'CUPON' THEN 'CAMPANA'
    WHEN 'PLACA' THEN 'PROMOCION'
    ELSE tipo
END
WHERE tipo IN ('CUPON', 'PLACA');

ALTER TABLE fg_descuento
    ADD CONSTRAINT chk_fg_descuento_tipo
    CHECK (tipo IN ('CAMPANA', 'ALIANZA', 'CONVENIO', 'PROMOCION'));

COMMENT ON COLUMN fg_descuento.tipo IS
    'Tipo de campaña FAREGAS: CAMPANA, ALIANZA, CONVENIO o PROMOCION';
