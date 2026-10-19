BEGIN;

-- ---------------------------------------------------------------------------
-- IGUALDAD TEMPORAL DE PERMISOS ENTRE PERFILES (fase de desarrollo/pruebas)
--
-- OBJETIVO
--   Durante esta fase, TODOS los perfiles activos deben tener exactamente el
--   mismo conjunto de permisos que el perfil SISTEMAS, que es la referencia.
--
-- POR QUE
--   Se venía encontrando restricciones una por una (INGRESAR STOCK, VENDER
--   CHIPS, etc.) porque cada perfil tenía un subconjunto distinto de permisos.
--   En lugar de seguir ampliando permisos caso por caso, se iguala todos los
--   perfiles al perfil de referencia.
--
-- QUE NO SE TOCA
--   - fg_usuario.perfil_id  : los usuarios siguen siendo OPERADOR, SISTEMAS, etc.
--   - fg_usuario_planta     : las sedes asignadas de cada usuario no cambian.
--   - fg_perfil_planta      : las sedes por perfil no cambian.
--   - fg_permiso            : el catálogo de permisos no se modifica.
--   - fg_perfil_permiso     : sólo se COMPLETA; nunca se borra nada.
--
--   La igualdad es de PERMISOS, no de TERRITORIO: un OPERADOR con una sola
--   sede sigue trabajando únicamente sobre esa sede, por la lógica de planta
--   ya existente. Mismos permisos != acceso a todas las sedes.
--
-- TEMPORAL
--   Para revertirlo basta con redefinir el set real de cada perfil desde
--   Configuración > Usuarios. Este archivo es idempotente: se puede volver a
--   ejecutar sin duplicar registros.
-- ---------------------------------------------------------------------------

-- 1. El perfil de referencia debe existir. Sin él la sincronización no tendría
--    sentido, así que se aborta de forma explícita en vez de copiar un set vacío.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM fg_perfil WHERE clave = 'SISTEMAS') THEN
        RAISE EXCEPTION 'Perfil de referencia SISTEMAS no existe: no se sincroniza nada';
    END IF;
END $$;

-- 2. Todo perfil activo distinto de SISTEMAS hereda el set completo de SISTEMAS.
--    Se hace sobre el catálogo de permisos ACTIVOS, de modo que un permiso
--    dado de baja no se.reactive ni se propague a otros perfiles.
INSERT INTO fg_perfil_permiso (perfil_clave, permiso_clave)
SELECT
    perfiles.clave,
    referencia.permiso_clave
FROM fg_perfil perfiles
CROSS JOIN fg_perfil_permiso referencia
WHERE perfiles.clave <> 'SISTEMAS'
  AND referencia.perfil_clave = 'SISTEMAS'
  AND EXISTS (
        SELECT 1
        FROM fg_permiso permiso
        WHERE permiso.clave = referencia.permiso_clave
          AND permiso.activo = TRUE
      )
ON CONFLICT (perfil_clave, permiso_clave) DO NOTHING;

-- 3. Verificación. Se informa cualquier diferencia en vez de borrarla en
--    silencio: al no existir permisos extra, sólo puede haber faltantes, y este
--    paso los acaba de cubrir. Si algún día un perfil tuviera un permiso que
--    SISTEMAS no tiene, se reporta aquí para decidirlo con evidencia.
DO $$
DECLARE
    diferencias text;
BEGIN
    SELECT string_agg(
        pp.perfil_clave || ' tiene el permiso ' || pp.permiso_clave || ' que SISTEMAS no tiene',
        E'\n'
    )
    INTO diferencias
    FROM fg_perfil_permiso pp
    WHERE pp.perfil_clave <> 'SISTEMAS'
      AND NOT EXISTS (
            SELECT 1 FROM fg_perfil_permiso ref
            WHERE ref.perfil_clave = 'SISTEMAS'
              AND ref.permiso_clave = pp.permiso_clave
      );

    IF diferencias IS NOT NULL THEN
        RAISE WARNING 'Permisos fuera del set de SISTEMAS (no se borran, se reportan): %', diferencias;
    END IF;
END $$;

COMMIT;
