BEGIN;

-- Datos para facturación reutiliza el mismo tipo documental que fg_cliente.
-- Se amplían únicamente las columnas de captura para admitir el código real
-- CARNETEXTRANJERIA y su número alfanumérico, sin alterar registros existentes.
ALTER TABLE fg_facturacion
    DROP CONSTRAINT IF EXISTS ck_fg_facturacion_documento;

ALTER TABLE fg_facturacion
    ALTER COLUMN tipo_documento_cliente TYPE VARCHAR(20),
    ALTER COLUMN nro_documento TYPE VARCHAR(20);

ALTER TABLE fg_facturacion
    ADD CONSTRAINT ck_fg_facturacion_documento
    CHECK (tipo_documento_cliente IN ('DNI', 'RUC', 'CARNETEXTRANJERIA'));

COMMIT;
