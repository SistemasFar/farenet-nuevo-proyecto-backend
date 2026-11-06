BEGIN;

-- Campos del maestro DMS que no tenían equivalente en el catálogo fiscal.
-- Todos son opcionales para conservar íntegros los productos históricos.
ALTER TABLE fg_producto_facturacion
    ADD COLUMN IF NOT EXISTS codigo_barras VARCHAR(120),
    ADD COLUMN IF NOT EXISTS codigo_afectacion_isc VARCHAR(20),
    ADD COLUMN IF NOT EXISTS imagen_url TEXT;

COMMENT ON COLUMN fg_producto_facturacion.precio_referencia IS
    'Precio de venta unitario del maestro comercial; no reemplaza la tarifa por sede.';
COMMENT ON COLUMN fg_producto_facturacion.codigo_barras IS
    'Código de barras opcional proveniente del maestro comercial DMS.';
COMMENT ON COLUMN fg_producto_facturacion.codigo_afectacion_isc IS
    'Código de afectación ISC opcional del maestro fiscal DMS.';
COMMENT ON COLUMN fg_producto_facturacion.imagen_url IS
    'URL opcional de la imagen del producto; no almacena binarios.';

COMMIT;
