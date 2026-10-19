-- ===========================================================================
-- Submódulos de Configuración: permisos granulares de navegación
-- ===========================================================================
-- Los permisos MENU_CONFIGURACION_* controlan únicamente qué pestañas se
-- muestran. No sustituyen a CONFIGURACION_SEDES, CONFIGURACION_PRODUCTOS,
-- CONFIGURACION_TARIFAS, CONFIGURACION_SERIES ni CONFIGURACION_EMPRESAS, que
-- siguen siendo la autoridad operativa de los endpoints existentes.

INSERT INTO fg_permiso (clave, nombre, modulo, descripcion, activo)
VALUES
    ('MENU_CONFIGURACION_SEDES', 'Sedes / Categorías DMS', 'MENU',
     'Acceso a la pestaña Sedes / Categorías DMS del módulo Configuración', TRUE),
    ('MENU_CONFIGURACION_CATALOGO', 'Catálogo', 'MENU',
     'Acceso a la pestaña Catálogo del módulo Configuración', TRUE),
    ('MENU_CONFIGURACION_TARIFAS', 'Tarifas por sede', 'MENU',
     'Acceso a la pestaña Tarifas por sede del módulo Configuración', TRUE),
    ('MENU_CONFIGURACION_CORRELATIVOS', 'Correlativos', 'MENU',
     'Acceso a la pestaña Correlativos de certificados del módulo Configuración', TRUE),
    ('MENU_CONFIGURACION_EMPRESAS', 'Empresas', 'MENU',
     'Acceso a la pestaña Empresas del módulo Configuración', TRUE)
ON CONFLICT (clave) DO UPDATE
SET nombre = EXCLUDED.nombre,
    modulo = EXCLUDED.modulo,
    descripcion = EXCLUDED.descripcion,
    activo = EXCLUDED.activo;

-- Conserva exactamente la visibilidad anterior de cada perfil. El permiso
-- padre es obligatorio porque sin MENU_CONFIGURACION la pestaña nunca estuvo
-- disponible desde el menú. ON CONFLICT permite reaplicar la migración.

INSERT INTO fg_perfil_permiso (perfil_clave, permiso_clave)
SELECT DISTINCT padre.perfil_clave, reglas.permiso_menu
FROM fg_perfil_permiso padre
JOIN (
    VALUES
        ('MENU_CONFIGURACION_SEDES', ARRAY['CONFIGURACION_SEDES']::varchar[]),
        ('MENU_CONFIGURACION_CATALOGO', ARRAY['CONFIGURACION_CATEGORIAS', 'CONFIGURACION_SERVICIOS', 'CONFIGURACION_PRODUCTOS']::varchar[]),
        ('MENU_CONFIGURACION_TARIFAS', ARRAY['CONFIGURACION_TARIFAS']::varchar[]),
        ('MENU_CONFIGURACION_CORRELATIVOS', ARRAY['CONFIGURACION_SERIES']::varchar[]),
        ('MENU_CONFIGURACION_EMPRESAS', ARRAY['CONFIGURACION_EMPRESAS', 'CONFIGURACION_SEDES']::varchar[])
) AS reglas(permiso_menu, permisos_operativos) ON TRUE
WHERE padre.permiso_clave = 'MENU_CONFIGURACION'
  AND EXISTS (
      SELECT 1
      FROM fg_perfil_permiso operativo
      WHERE operativo.perfil_clave = padre.perfil_clave
        AND operativo.permiso_clave = ANY(reglas.permisos_operativos)
  )
ON CONFLICT DO NOTHING;
