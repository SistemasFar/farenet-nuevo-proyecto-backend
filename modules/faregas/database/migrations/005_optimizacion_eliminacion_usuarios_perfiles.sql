-- ============================================================================
-- MIGRACIÓN INCREMENTAL: 005_optimizacion_eliminacion_usuarios_perfiles.sql
-- Sistema: FAREGAS
-- Objetivo: Optimizar la eliminación y reasignación de perfiles y usuarios FAREGAS:
--           1. fg_perfil_permiso: ON DELETE CASCADE para permisos de perfil.
--           2. fg_perfil_planta: ON DELETE CASCADE para sedes de perfil.
--           3. fg_auditoria_config: Desvincular clave foránea restrictiva para
--              preservar snapshots históricos de auditoría sin bloquear la
--              gestión de cuentas de usuarios.
-- Idempotencia: 100% seguro para re-ejecución sin duplicados ni pérdida de datos.
-- ============================================================================

BEGIN;

-- 1. Cascada en permisos de perfiles (fg_perfil_permiso -> fg_perfil)
DO $$
DECLARE
    r RECORD;
BEGIN
    -- Eliminar cualquier FK existente desde fg_perfil_permiso hacia fg_perfil
    FOR r IN (
        SELECT tc.constraint_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
        JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
        WHERE tc.table_name = 'fg_perfil_permiso'
          AND kcu.column_name = 'perfil_clave'
          AND ccu.table_name = 'fg_perfil'
    ) LOOP
        EXECUTE 'ALTER TABLE public.fg_perfil_permiso DROP CONSTRAINT ' || quote_ident(r.constraint_name);
    END LOOP;

    -- Agregar la FK con ON DELETE CASCADE
    ALTER TABLE public.fg_perfil_permiso
        ADD CONSTRAINT fk_fg_pp_perfil
        FOREIGN KEY (perfil_clave) REFERENCES public.fg_perfil(clave)
        ON UPDATE CASCADE ON DELETE CASCADE;
END $$;

-- 2. Cascada en plantas/sedes de perfiles (fg_perfil_planta -> fg_perfil)
DO $$
DECLARE
    r RECORD;
BEGIN
    -- Eliminar cualquier FK existente desde fg_perfil_planta hacia fg_perfil
    FOR r IN (
        SELECT tc.constraint_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
        JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
        WHERE tc.table_name = 'fg_perfil_planta'
          AND kcu.column_name = 'perfil_clave'
          AND ccu.table_name = 'fg_perfil'
    ) LOOP
        EXECUTE 'ALTER TABLE public.fg_perfil_planta DROP CONSTRAINT ' || quote_ident(r.constraint_name);
    END LOOP;

    -- Agregar la FK con ON DELETE CASCADE
    ALTER TABLE public.fg_perfil_planta
        ADD CONSTRAINT fg_perfil_planta_perfil_clave_fkey
        FOREIGN KEY (perfil_clave) REFERENCES public.fg_perfil(clave)
        ON UPDATE CASCADE ON DELETE CASCADE;
END $$;

-- 3. Auditoría histórica: eliminar restricción FK para preservar el nombre de usuario
--    como snapshot histórico inmutable sin bloquear la baja de usuarios.
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (
        SELECT tc.constraint_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
        JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
        WHERE tc.table_name = 'fg_auditoria_config'
          AND kcu.column_name = 'username'
          AND ccu.table_name = 'fg_usuario'
    ) LOOP
        EXECUTE 'ALTER TABLE public.fg_auditoria_config DROP CONSTRAINT ' || quote_ident(r.constraint_name);
    END LOOP;
END $$;

COMMIT;
