BEGIN;

-- ---------------------------------------------------------------------------
-- Permiso real de venta de chips
--
-- Antes, el listado de ventas y la venta usaban ambos `CHIPS_VER`
-- ("Ver inventario de chips"), que es un permiso de LECTURA. Como el perfil
-- OPERADOR sólo tenía MENU_CHIPS, el inventario cargaba pero
-- "VENTAS DE CHIPS" respondía 403.
--
-- Este permiso separa lectura de escritura sin quitar el sistema de permisos:
--   CHIPS_VER     -> consultar inventario, listado de ventas y detalle
--   CHIPS_VENDER  -> reservar/liberar, validar, vender y emitir comprobante
-- ---------------------------------------------------------------------------

INSERT INTO fg_permiso (clave, nombre, modulo, descripcion, activo)
VALUES (
    'CHIPS_VENDER',
    'Vender chips',
    'FAREGAS',
    'Reservar y liberar chips, validar y registrar ventas de chips con su comprobante',
    TRUE
)
ON CONFLICT (clave) DO UPDATE
SET nombre = EXCLUDED.nombre,
    modulo = EXCLUDED.modulo,
    descripcion = EXCLUDED.descripcion,
    activo = EXCLUDED.activo;

-- OPERADOR: lectura de inventario/ventas + flujo operativo de venta.
INSERT INTO fg_perfil_permiso (perfil_clave, permiso_clave)
VALUES
    ('OPERADOR', 'CHIPS_VER'),
    ('OPERADOR', 'CHIPS_VENDER')
ON CONFLICT DO NOTHING;

-- SISTEMAS conserva el acceso completo que ya tenía.
INSERT INTO fg_perfil_permiso (perfil_clave, permiso_clave)
SELECT DISTINCT pp.perfil_clave, 'CHIPS_VENDER'
FROM fg_perfil_permiso pp
WHERE pp.permiso_clave = 'CHIPS_VER'
ON CONFLICT DO NOTHING;

COMMIT;
