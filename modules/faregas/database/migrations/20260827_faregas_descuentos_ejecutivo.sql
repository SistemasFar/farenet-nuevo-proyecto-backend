-- Ejecutivo o colaborador responsable de una alianza FAREGAS.

ALTER TABLE fg_descuento
    ADD COLUMN IF NOT EXISTS ejecutivo VARCHAR(150) NULL;

COMMENT ON COLUMN fg_descuento.ejecutivo IS
    'Nombre del colaborador responsable. Se utiliza para campañas de tipo ALIANZA';
