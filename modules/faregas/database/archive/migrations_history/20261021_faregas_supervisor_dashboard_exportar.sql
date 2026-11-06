BEGIN;

-- Habilita el acceso operativo y exportación Excel del Dashboard para el perfil SUPERVISOR
INSERT INTO fg_perfil_permiso (perfil_clave, permiso_clave)
VALUES
    ('SUPERVISOR', 'MENU_DASHBOARD'),
    ('SUPERVISOR', 'DASHBOARD_SEDE'),
    ('SUPERVISOR', 'DASHBOARD_GLOBAL'),
    ('SUPERVISOR', 'DASHBOARD_EXPORTAR')
ON CONFLICT (perfil_clave, permiso_clave) DO NOTHING;

COMMIT;
