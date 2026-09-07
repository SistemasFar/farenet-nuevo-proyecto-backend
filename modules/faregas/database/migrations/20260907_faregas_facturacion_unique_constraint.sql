BEGIN;

-- 1. Crear el nuevo constraint más específico que incluye emisor, entorno y tipo de comprobante.
-- PostgreSQL permite múltiples NULLs, por lo que los borradores (serie IS NULL) no colisionarán.
ALTER TABLE fg_facturacion 
ADD CONSTRAINT uq_fg_facturacion_emisor_serie_numero 
UNIQUE (ruc_emisor, entorno_facturador, tipo_comprobante, serie, numero);

-- 2. Eliminar el constraint antiguo que era demasiado estricto (no permitía misma serie en distintos entornos o empresas).
ALTER TABLE fg_facturacion 
DROP CONSTRAINT IF EXISTS uq_fg_facturacion_serie_numero;

COMMIT;
