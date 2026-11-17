-- Permisos de consulta y exportación del Dashboard para perfiles operativos.
-- No altera usuarios ni asignaciones de sedes. El backend mantiene el filtro
-- por las sedes autorizadas a cada usuario.
BEGIN;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM (VALUES
            ('CONTADOR', 'DASHBOARD_GLOBAL'),
            ('CONTADOR', 'DASHBOARD_EXPORTAR'),
            ('OPERADOR', 'MENU_DASHBOARD'),
            ('OPERADOR', 'DASHBOARD_GLOBAL'),
            ('OPERADOR', 'DASHBOARD_EXPORTAR')
        ) AS requeridos(perfil_clave, permiso_clave)
        LEFT JOIN public.fg_perfil perfil ON perfil.clave = requeridos.perfil_clave
        LEFT JOIN public.fg_permiso permiso
            ON permiso.clave = requeridos.permiso_clave
           AND permiso.activo = TRUE
        WHERE perfil.clave IS NULL
           OR perfil.visible IS DISTINCT FROM TRUE
           OR permiso.clave IS NULL
    ) THEN
        RAISE EXCEPTION 'No se pueden asignar permisos Dashboard: perfil no visible o permiso inexistente/inactivo.';
    END IF;
END $$;

INSERT INTO public.fg_perfil_permiso (perfil_clave, permiso_clave)
VALUES
    ('CONTADOR', 'DASHBOARD_GLOBAL'),
    ('CONTADOR', 'DASHBOARD_EXPORTAR'),
    ('OPERADOR', 'MENU_DASHBOARD'),
    ('OPERADOR', 'DASHBOARD_GLOBAL'),
    ('OPERADOR', 'DASHBOARD_EXPORTAR')
ON CONFLICT (perfil_clave, permiso_clave) DO NOTHING;

COMMIT;
