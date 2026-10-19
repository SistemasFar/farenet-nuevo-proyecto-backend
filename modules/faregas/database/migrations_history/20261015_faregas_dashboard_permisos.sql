-- Migración: Permisos para el Módulo de Dashboard FAREGAS
-- Fecha: 2026-10-15
-- Perfiles autorizados: SISTEMAS y AMINISTRADOR

DO $$
BEGIN
    -- 1. Insertar permisos en fg_permiso de manera idempotente
    INSERT INTO fg_permiso (clave, nombre, modulo, descripcion, activo)
    VALUES
        ('MENU_DASHBOARD', 'Dashboard FAREGAS', 'MENU', 'Acceso al módulo Dashboard en la barra lateral', true),
        ('DASHBOARD_GLOBAL', 'Dashboard Global Multi-Sede', 'FAREGAS', 'Permite consolidar métricas de todas las sedes autorizadas del usuario', true),
        ('DASHBOARD_SEDE', 'Dashboard de Sede Operativa', 'FAREGAS', 'Permite visualizar métricas exclusivas de la sede activa en sesión', true),
        ('DASHBOARD_EXPORTAR', 'Exportar Métricas del Dashboard', 'FAREGAS', 'Permite descargar el libro Excel multi-pestaña con datos del dashboard', true)
    ON CONFLICT (clave) DO UPDATE SET
        nombre = EXCLUDED.nombre,
        modulo = EXCLUDED.modulo,
        descripcion = EXCLUDED.descripcion,
        activo = true;

    -- 2. Asignar permisos a SISTEMAS
    INSERT INTO fg_perfil_permiso (perfil_clave, permiso_clave, created_at)
    VALUES
        ('SISTEMAS', 'MENU_DASHBOARD', NOW()),
        ('SISTEMAS', 'DASHBOARD_GLOBAL', NOW()),
        ('SISTEMAS', 'DASHBOARD_SEDE', NOW()),
        ('SISTEMAS', 'DASHBOARD_EXPORTAR', NOW())
    ON CONFLICT DO NOTHING;

    -- 3. Asignar permisos a AMINISTRADOR (exactamente como figura en BD)
    IF EXISTS (SELECT 1 FROM fg_perfil WHERE clave = 'AMINISTRADOR') THEN
        INSERT INTO fg_perfil_permiso (perfil_clave, permiso_clave, created_at)
        VALUES
            ('AMINISTRADOR', 'MENU_DASHBOARD', NOW()),
            ('AMINISTRADOR', 'DASHBOARD_GLOBAL', NOW()),
            ('AMINISTRADOR', 'DASHBOARD_SEDE', NOW()),
            ('AMINISTRADOR', 'DASHBOARD_EXPORTAR', NOW())
        ON CONFLICT DO NOTHING;
    END IF;

    -- En caso de existir ADMIN o ADMINISTRADOR como alias histórico
    IF EXISTS (SELECT 1 FROM fg_perfil WHERE clave = 'ADMINISTRADOR') THEN
        INSERT INTO fg_perfil_permiso (perfil_clave, permiso_clave, created_at)
        VALUES
            ('ADMINISTRADOR', 'MENU_DASHBOARD', NOW()),
            ('ADMINISTRADOR', 'DASHBOARD_GLOBAL', NOW()),
            ('ADMINISTRADOR', 'DASHBOARD_SEDE', NOW()),
            ('ADMINISTRADOR', 'DASHBOARD_EXPORTAR', NOW())
        ON CONFLICT DO NOTHING;
    END IF;
END $$;
