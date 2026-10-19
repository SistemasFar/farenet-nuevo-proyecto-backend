-- Migración idempotente para sanear los certificados base (Categoría 12345 / SSS)

BEGIN;

-- 1. Desactivar Categoría de Prueba 12345
UPDATE fg_categoria_servicio
SET activo = false
WHERE codigo = '12345' AND activo = true;

-- 2. Desactivar Servicio SSS y quitarle la asociación rígida a GNV_ANUAL
UPDATE fg_servicio
SET activo = false,
    tipo_certificado_clave = NULL,
    modalidad = NULL
WHERE codigo = 'SSS';

-- 3. Desactivar Producto de Facturación 12345 (Si existiera y siguiera activo)
UPDATE fg_producto_facturacion
SET activo = false
WHERE codigo_sku = '12345' AND activo = true;

-- 4. Desactivar Tarifas asociadas a SSS
UPDATE fg_tarifa
SET activo = false
WHERE codigo = 'SSS' AND activo = true;

COMMIT;