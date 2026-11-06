BEGIN;

INSERT INTO fg_permiso (clave, nombre, modulo, descripcion, activo)
VALUES (
    'FAREGAS_ACCESO_GLOBAL_SEDES',
    'Acceso global a sedes',
    'FAREGAS',
    'Permite operar en todas las sedes activas, sin conceder permisos operativos adicionales.',
    TRUE
)
ON CONFLICT (clave) DO UPDATE
SET nombre = EXCLUDED.nombre,
    modulo = EXCLUDED.modulo,
    descripcion = EXCLUDED.descripcion,
    activo = EXCLUDED.activo;

-- Conserva de forma explícita el alcance global que SISTEMAS tenía por código.
-- No modifica fg_usuario_planta ni concede permisos operativos.
INSERT INTO fg_perfil_permiso (perfil_clave, permiso_clave)
SELECT p.clave, 'FAREGAS_ACCESO_GLOBAL_SEDES'
FROM fg_perfil p
WHERE p.clave = 'SISTEMAS'
ON CONFLICT (perfil_clave, permiso_clave) DO NOTHING;

COMMIT;
