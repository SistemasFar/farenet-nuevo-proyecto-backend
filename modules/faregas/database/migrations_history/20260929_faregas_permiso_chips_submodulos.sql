BEGIN;

-- ===========================================================================
-- Submódulos de Chips: permisos de navegación granulares
-- ===========================================================================
--
-- La arquitectura ya está definida en 20260910_faregas_menu_chips.sql:
--   "La visibilidad del sidebar pertenece al módulo MENU. Los permisos
--    CHIPS_* continúan representando capacidades operativas dentro del
--    inventario."
--
-- Por eso estos tres permisos son de módulo 'MENU' (navegación) y NO
-- reemplazan a los CHIPS_* que ya existen:
--
--   MENU_CHIPS            -> muestra el módulo en el sidebar (ya existe)
--   MENU_CHIPS_INVENTARIO -> muestra la pestaña "Inventario de chips"
--   MENU_CHIPS_TIPOS      -> muestra la pestaña "Tipos de chip"
--   MENU_CHIPS_VENTAS     -> muestra la pestaña "Ventas de chips"
--
-- El permiso de una capacidad sigue siendo el CHIPS_* correspondiente
-- (CHIPS_VER, CHIPS_CONFIGURAR, CHIPS_VENDER, CHIPS_INGRESAR,
-- CHIPS_TRANSFERIR, CHIPS_BAJA). Ninguno se modifica ni se elimina.
--
-- Se evita deliberadamente el prefijo CHIPS_INVENTARIO / CHIPS_TIPOS /
-- CHIPS_VENTAS: esas claves sonarían a permisos operativos nuevos y
-- duplicarían la autoridad de los CHIPS_* actuales.

INSERT INTO fg_permiso (clave, nombre, modulo, descripcion, activo)
VALUES
    ('MENU_CHIPS_INVENTARIO', 'Inventario de chips', 'MENU',
     'Acceso a la pestaña Inventario de chips (control de seriales y stock)', TRUE),
    ('MENU_CHIPS_TIPOS', 'Tipos de chip', 'MENU',
     'Acceso a la pestaña Tipos de chip (catálogo de productos inventariables)', TRUE),
    ('MENU_CHIPS_VENTAS', 'Ventas de chips', 'MENU',
     'Acceso a la pestaña Ventas de chips (operaciones y venta directa)', TRUE)
ON CONFLICT (clave) DO UPDATE
SET nombre = EXCLUDED.nombre,
    modulo = EXCLUDED.modulo,
    descripcion = EXCLUDED.descripcion,
    activo = EXCLUDED.activo;

-- ---------------------------------------------------------------------------
-- Estrategia de migración: NADIE PIERDE ACCESO
-- ---------------------------------------------------------------------------
-- Regla: todo perfil que hoy puede ver el módulo Chips conserva los tres
-- submódulos. "Hoy puede ver Chips" significa que tiene MENU_CHIPS, o bien
-- CHIPS_VER (la vía por la que se lo daba 20260910_faregas_menu_chips.sql a
-- partir de los perfiles que sólo tenían el permiso operativo).
--
-- Se sobre-otorgan los tres submódulos a propósito: es preferible granting de
-- más (que el administrador luego puede quitar desde Editar Perfil) que dejar
-- a un perfil sin un submódulo que antes sí alcanzaba. El acceso real al
-- endpoint lo sigue autorizando el CHIPS_* correspondiente, así que un
-- permiso de navegación de más no concede por sí solo ninguna operación.

INSERT INTO fg_perfil_permiso (perfil_clave, permiso_clave)
SELECT DISTINCT pp.perfil_clave, sub.clave
FROM fg_perfil_permiso pp
CROSS JOIN (
    VALUES ('MENU_CHIPS_INVENTARIO'),
           ('MENU_CHIPS_TIPOS'),
           ('MENU_CHIPS_VENTAS')
) AS sub(clave)
WHERE pp.permiso_clave IN ('MENU_CHIPS', 'CHIPS_VER')
ON CONFLICT DO NOTHING;

COMMIT;
