BEGIN;

-- El módulo evolucionó de un inventario exclusivo de chips a un inventario
-- general de productos físicos. Se conservan las claves de permisos para no
-- alterar perfiles ni autorizaciones existentes; sólo cambia el texto visible.
UPDATE fg_permiso
SET nombre = CASE clave
        WHEN 'MENU_CHIPS' THEN 'Inventario'
        WHEN 'MENU_CHIPS_INVENTARIO' THEN 'Inventario'
        WHEN 'MENU_CHIPS_TIPOS' THEN 'Tipos de producto'
        WHEN 'MENU_CHIPS_VENTAS' THEN 'Ventas'
    END,
    descripcion = CASE clave
        WHEN 'MENU_CHIPS' THEN 'Acceso al módulo de inventario de productos físicos FAREGAS'
        WHEN 'MENU_CHIPS_INVENTARIO' THEN 'Acceso a la pestaña Inventario (control de productos serializados y por cantidad)'
        WHEN 'MENU_CHIPS_TIPOS' THEN 'Acceso a la pestaña Tipos de producto (catálogo de productos inventariables)'
        WHEN 'MENU_CHIPS_VENTAS' THEN 'Acceso a la pestaña Ventas (operaciones y venta directa)'
    END
WHERE clave IN (
    'MENU_CHIPS',
    'MENU_CHIPS_INVENTARIO',
    'MENU_CHIPS_TIPOS',
    'MENU_CHIPS_VENTAS'
);

COMMIT;
