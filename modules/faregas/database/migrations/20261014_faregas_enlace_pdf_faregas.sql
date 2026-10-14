-- Migración: Agregar enlace_pdf_faregas a fg_facturacion para conservar
-- de forma independiente el PDF generado por FAREGAS y el PDF de NubeFact.

ALTER TABLE fg_facturacion
    ADD COLUMN IF NOT EXISTS enlace_pdf_faregas TEXT;

COMMENT ON COLUMN fg_facturacion.enlace_pdf_faregas IS 'Ruta o URL del PDF de representación impresa oficial generado por FAREGAS';
