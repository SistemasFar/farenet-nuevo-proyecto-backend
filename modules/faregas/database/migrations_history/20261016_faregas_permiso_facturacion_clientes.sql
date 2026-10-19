-- ===========================================================================
-- Facturación: permiso independiente para el directorio de Clientes
-- ===========================================================================
--
-- Hasta esta migración, la pestaña CLIENTES reutilizaba el permiso
-- MENU_FACTURACION_COMPROBANTES. Esto impedía administrarla de forma separada
-- desde Editar Perfil. El nuevo permiso controla exclusivamente la navegación
-- y la consulta del directorio; no cambia la captura de clientes del wizard.

INSERT INTO fg_permiso (clave, nombre, modulo, descripcion, activo)
VALUES (
    'MENU_FACTURACION_CLIENTES',
    'Clientes',
    'MENU',
    'Acceso a la pestaña Clientes y al directorio de clientes de facturación',
    TRUE
)
ON CONFLICT (clave) DO UPDATE
SET nombre = EXCLUDED.nombre,
    modulo = EXCLUDED.modulo,
    descripcion = EXCLUDED.descripcion,
    activo = EXCLUDED.activo;

-- Compatibilidad: antes veía Clientes todo perfil que tenía Comprobantes.
-- Se replica esa autorización una sola vez para que nadie pierda acceso; desde
-- Editar Perfil ambos submódulos ya se pueden activar o quitar por separado.
INSERT INTO fg_perfil_permiso (perfil_clave, permiso_clave)
SELECT perfil_clave, 'MENU_FACTURACION_CLIENTES'
FROM fg_perfil_permiso
WHERE permiso_clave = 'MENU_FACTURACION_COMPROBANTES'
ON CONFLICT (perfil_clave, permiso_clave) DO NOTHING;
