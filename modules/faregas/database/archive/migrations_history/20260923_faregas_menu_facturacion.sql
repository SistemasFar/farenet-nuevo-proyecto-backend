BEGIN;

-- Permiso de navegación independiente para el módulo de facturación.
-- Las capacidades internas (series, comprobantes y preparación) se protegen
-- en backend con esta misma clave.
INSERT INTO fg_permiso (clave, nombre, modulo, descripcion, activo)
VALUES (
    'MENU_FACTURACION',
    'Facturación',
    'MENU',
    'Acceso al módulo de facturación electrónica FAREGAS',
    TRUE
)
ON CONFLICT (clave) DO UPDATE
SET nombre = EXCLUDED.nombre,
    modulo = EXCLUDED.modulo,
    descripcion = EXCLUDED.descripcion,
    activo = EXCLUDED.activo;

-- Conserva el acceso de quienes administraban la antigua pestaña de series.
-- Desde Administración de Usuarios se podrá conceder o retirar después.
INSERT INTO fg_perfil_permiso (perfil_clave, permiso_clave)
SELECT DISTINCT pp.perfil_clave, 'MENU_FACTURACION'
FROM fg_perfil_permiso pp
WHERE pp.permiso_clave = 'CONFIGURACION_SERIES'
ON CONFLICT DO NOTHING;

-- El perfil técnico debe poder administrar el módulo aunque una instalación
-- antigua todavía no tenga CONFIGURACION_SERIES asignado.
INSERT INTO fg_perfil_permiso (perfil_clave, permiso_clave)
SELECT 'SISTEMAS', 'MENU_FACTURACION'
WHERE EXISTS (SELECT 1 FROM fg_perfil WHERE clave = 'SISTEMAS')
ON CONFLICT DO NOTHING;

COMMIT;
