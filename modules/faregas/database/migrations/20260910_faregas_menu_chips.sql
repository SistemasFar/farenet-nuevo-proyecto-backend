BEGIN;

-- La visibilidad del sidebar pertenece al módulo MENU. Los permisos CHIPS_*
-- continúan representando capacidades operativas dentro del inventario.
INSERT INTO fg_permiso (clave, nombre, modulo, descripcion, activo)
VALUES (
    'MENU_CHIPS',
    'Chips',
    'MENU',
    'Acceso al módulo de inventario de chips FAREGAS',
    TRUE
)
ON CONFLICT (clave) DO UPDATE
SET nombre = EXCLUDED.nombre,
    modulo = EXCLUDED.modulo,
    descripcion = EXCLUDED.descripcion,
    activo = EXCLUDED.activo;

-- Conserva el acceso de los perfiles que ya tenían autorización de consulta.
-- Los demás perfiles podrán recibir MENU_CHIPS desde Administración de Usuarios.
INSERT INTO fg_perfil_permiso (perfil_clave, permiso_clave)
SELECT DISTINCT pp.perfil_clave, 'MENU_CHIPS'
FROM fg_perfil_permiso pp
WHERE pp.permiso_clave = 'CHIPS_VER'
ON CONFLICT DO NOTHING;

COMMIT;
