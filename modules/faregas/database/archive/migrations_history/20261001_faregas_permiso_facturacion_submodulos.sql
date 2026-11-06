-- ===========================================================================
-- Submódulos de Facturación: permisos de navegación granulares
-- ===========================================================================
--
-- Patrón tomado de 20260929_faregas_permiso_chips_submodulos.sql, que a su vez
-- lo sigue de 20260910_faregas_menu_chips.sql: la visibilidad del sidebar
-- pertenece al módulo MENU, y los permisos por capacidad son de módulo
-- 'FAREGAS'. Estos tres permisos son de navegación (MENU) y NO reemplazan al
-- CONFIGURACION_SERIES ni a ningún otro permiso operativo existente.
--
--   MENU_FACTURACION            -> muestra el módulo en el sidebar (ya existe)
--   MENU_FACTURACION_PREPARACION-> muestra la pestaña PREPARACIÓN
--   MENU_FACTURACION_SERIES     -> muestra la pestaña SERIES
--   MENU_FACTURACION_COMPROBANTES-> muestra la pestaña COMPROBANTES
--
-- Se evita deliberadamente el prefijo sin MENU_ (FACTURACION_PREPARACION):
-- sonarían a permisos operativos nuevos y duplicarían la autoridad de los
-- existentes, exactamente el problema que la migración de Chips ya resolvió.
--
-- Nombres de las pestañas: se copian de TabFacturacion.tsx, que es quien las
-- dibuja. 'Comprobantes' y no 'Documentos' porque así se le llama en la UI.

INSERT INTO fg_permiso (clave, nombre, modulo, descripcion, activo)
VALUES
    ('MENU_FACTURACION_PREPARACION', 'Preparación', 'MENU',
     'Acceso a la pestaña Preparación de facturación (estado de NubeFact por sede)', TRUE),
    ('MENU_FACTURACION_SERIES', 'Series', 'MENU',
     'Acceso a la pestaña Series de facturación (series Nubefact y DMS por sede)', TRUE),
    ('MENU_FACTURACION_COMPROBANTES', 'Comprobantes', 'MENU',
     'Acceso a la pestaña Comprobantes (seguimiento de comprobantes emitidos)', TRUE)
ON CONFLICT (clave) DO UPDATE
SET nombre = EXCLUDED.nombre,
    modulo = EXCLUDED.modulo,
    descripcion = EXCLUDED.descripcion,
    activo = EXCLUDED.activo;

-- ---------------------------------------------------------------------------
-- Estrategia de migración: NADIE PIERDE ACCESO
-- ---------------------------------------------------------------------------
-- Regla: todo perfil que hoy puede ver el módulo Facturación conserva los tres
-- submódulos. "Hoy puede ver Facturación" es tener MENU_FACTURACION, o bien
-- MENU_CONFIGURACION con CONFIGURACION_SERIES (las dos vías por las que
-- requireConfigSeriesPerm y facturacionAdminMiddleware ya abrían el módulo).
--
-- Se sobre-otorgan los tres a propósito: es preferible granting de más —que el
-- administrador puede quitar después desde Editar Perfil— que dejar a un perfil
-- sin una pestaña que antes sí alcanzaba. El acceso real a cada endpoint lo
-- sigue autorizando el permiso operativo que ya existía, así que un permiso de
-- navegación de más no concede por sí solo ninguna operación.

INSERT INTO fg_perfil_permiso (perfil_clave, permiso_clave)
SELECT DISTINCT pp.perfil_clave, sub.clave
FROM fg_perfil_permiso pp
CROSS JOIN (
    VALUES ('MENU_FACTURACION_PREPARACION'),
           ('MENU_FACTURACION_SERIES'),
           ('MENU_FACTURACION_COMPROBANTES')
) AS sub(clave)
WHERE pp.permiso_clave = 'MENU_FACTURACION'
   OR (
       pp.permiso_clave = 'MENU_CONFIGURACION'
       AND EXISTS (
           SELECT 1 FROM fg_perfil_permiso serie
           WHERE serie.perfil_clave = pp.perfil_clave
             AND serie.permiso_clave = 'CONFIGURACION_SERIES'
       )
   )
ON CONFLICT DO NOTHING;
