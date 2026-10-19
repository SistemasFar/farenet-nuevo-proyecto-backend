BEGIN;

-- El perfil SUPERVISOR ya tenia visibles estos modulos, pero solo contaba con
-- permisos MENU_* de navegacion. Los endpoints mantienen una segunda barrera
-- de permisos operativos; por eso la pantalla abria y luego respondia 403.
--
-- Esta matriz habilita la supervision operativa de descuentos, inventario,
-- ventas y configuracion. No convierte al perfil en administrador de
-- seguridad ni modifica sus sedes autorizadas.

INSERT INTO fg_perfil_permiso (perfil_clave, permiso_clave)
VALUES
    -- Descuentos
    ('SUPERVISOR', 'MENU_DESCUENTOS'),
    ('SUPERVISOR', 'DESCUENTOS_ADMINISTRAR'),

    -- Inventario y ventas de productos
    ('SUPERVISOR', 'MENU_CHIPS'),
    ('SUPERVISOR', 'MENU_CHIPS_INVENTARIO'),
    ('SUPERVISOR', 'MENU_CHIPS_TIPOS'),
    ('SUPERVISOR', 'MENU_CHIPS_VENTAS'),
    ('SUPERVISOR', 'CHIPS_VER'),
    ('SUPERVISOR', 'CHIPS_INGRESAR'),
    ('SUPERVISOR', 'CHIPS_TRANSFERIR'),
    ('SUPERVISOR', 'CHIPS_CONFIGURAR'),
    ('SUPERVISOR', 'CHIPS_VENDER'),
    ('SUPERVISOR', 'CHIPS_BAJA'),

    -- Configuracion operativa
    ('SUPERVISOR', 'MENU_CONFIGURACION'),
    ('SUPERVISOR', 'MENU_CONFIGURACION_SEDES'),
    ('SUPERVISOR', 'MENU_CONFIGURACION_CATALOGO'),
    ('SUPERVISOR', 'MENU_CONFIGURACION_TARIFAS'),
    ('SUPERVISOR', 'MENU_CONFIGURACION_CORRELATIVOS'),
    ('SUPERVISOR', 'MENU_CONFIGURACION_EMPRESAS'),
    ('SUPERVISOR', 'CONFIGURACION_SEDES'),
    ('SUPERVISOR', 'CONFIGURACION_CATEGORIAS'),
    ('SUPERVISOR', 'CONFIGURACION_SERVICIOS'),
    ('SUPERVISOR', 'CONFIGURACION_PRODUCTOS'),
    ('SUPERVISOR', 'CONFIGURACION_TARIFAS'),
    ('SUPERVISOR', 'CONFIGURACION_SERIES'),
    ('SUPERVISOR', 'CONFIGURACION_EMPRESAS')
ON CONFLICT (perfil_clave, permiso_clave) DO NOTHING;

COMMIT;
