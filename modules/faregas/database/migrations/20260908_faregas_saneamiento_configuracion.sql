BEGIN;

-- El inventario y la autorización comercial son decisiones independientes.
-- Una configuración activa puede almacenar stock sin estar habilitada para vender.
ALTER TABLE fg_producto_inventariable_sede
    ADD COLUMN IF NOT EXISTS stock_permitido BOOLEAN;

ALTER TABLE fg_producto_inventariable_sede
    ADD COLUMN IF NOT EXISTS venta_habilitada BOOLEAN;

UPDATE fg_producto_inventariable_sede
SET stock_permitido = COALESCE(stock_permitido, activo),
    venta_habilitada = COALESCE(venta_habilitada, FALSE),
    fecha_modificacion = CASE
        WHEN stock_permitido IS NULL OR venta_habilitada IS NULL THEN CURRENT_TIMESTAMP
        ELSE fecha_modificacion
    END
WHERE stock_permitido IS NULL OR venta_habilitada IS NULL;

ALTER TABLE fg_producto_inventariable_sede
    ALTER COLUMN stock_permitido SET DEFAULT FALSE,
    ALTER COLUMN stock_permitido SET NOT NULL,
    ALTER COLUMN venta_habilitada SET DEFAULT FALSE,
    ALTER COLUMN venta_habilitada SET NOT NULL;

-- La auditoría de configuración exige un usuario real. Si no existe un
-- administrador técnico, se aborta toda la transacción sin cambios parciales.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM fg_usuario
        WHERE perfil_id = 'SISTEMAS' AND estado = TRUE
    ) THEN
        RAISE EXCEPTION 'No existe un usuario SISTEMAS activo para auditar el saneamiento.';
    END IF;
END $$;

-- TEST_P1 se conserva para historia/pruebas, pero sale del alcance operativo.
WITH actor AS (
    SELECT username FROM fg_usuario
    WHERE perfil_id = 'SISTEMAS' AND estado = TRUE
    ORDER BY username LIMIT 1
), cambio AS (
    UPDATE fg_planta
    SET activo = FALSE
    WHERE key = 'TEST_P1' AND activo = TRUE
    RETURNING key, nombre, empresa_key
)
INSERT INTO fg_auditoria_config
    (username, entidad, accion, identificador, detalles, planta_key, ip_direccion)
SELECT actor.username, 'SEDE', 'RETIRAR_SEDE_PRUEBA_OPERACION', cambio.key,
       jsonb_build_object(
           'antes', jsonb_build_object('activo', TRUE),
           'despues', jsonb_build_object('activo', FALSE),
           'motivo', 'TEST_P1 se conserva para pruebas e historial, fuera del alcance productivo'
       ), cambio.key, NULL
FROM cambio CROSS JOIN actor;

WITH actor AS (
    SELECT username FROM fg_usuario
    WHERE perfil_id = 'SISTEMAS' AND estado = TRUE
    ORDER BY username LIMIT 1
), cambio AS (
    UPDATE fg_producto_inventariable_sede pis
    SET activo = FALSE,
        stock_permitido = FALSE,
        venta_habilitada = FALSE,
        fecha_modificacion = CURRENT_TIMESTAMP
    FROM fg_producto_inventariable pi
    WHERE pis.producto_inventariable_id = pi.id
      AND pi.codigo = 'CHIP'
      AND pis.planta_key = 'TEST_P1'
      AND (pis.activo = TRUE OR pis.stock_permitido = TRUE OR pis.venta_habilitada = TRUE)
    RETURNING pis.id, pis.planta_key
)
INSERT INTO fg_auditoria_config
    (username, entidad, accion, identificador, detalles, planta_key, ip_direccion)
SELECT actor.username, 'PRODUCTO_INVENTARIABLE_SEDE', 'DESACTIVAR_CHIP_SEDE_PRUEBA', cambio.id::text,
       jsonb_build_object(
           'producto', 'CHIP',
           'despues', jsonb_build_object(
               'activo', FALSE,
               'stock_permitido', FALSE,
               'venta_habilitada', FALSE
           ),
           'motivo', 'TEST_P1 fuera del alcance operativo'
       ), cambio.planta_key, NULL
FROM cambio CROSS JOIN actor;

-- Se desactivan los registros demostrativos sin borrar sus relaciones históricas.
WITH actor AS (
    SELECT username FROM fg_usuario
    WHERE perfil_id = 'SISTEMAS' AND estado = TRUE
    ORDER BY username LIMIT 1
), cambio AS (
    UPDATE fg_categoria_servicio
    SET activo = FALSE, fecha_modificacion = CURRENT_TIMESTAMP
    WHERE codigo = '12345' AND activo = TRUE
    RETURNING id, codigo, nombre
)
INSERT INTO fg_auditoria_config
    (username, entidad, accion, identificador, detalles, planta_key, ip_direccion)
SELECT actor.username, 'CATEGORIA', 'DESACTIVAR_CATEGORIA_DEMOSTRATIVA', cambio.id::text,
       jsonb_build_object(
           'codigo', cambio.codigo,
           'nombre', cambio.nombre,
           'antes', jsonb_build_object('activo', TRUE),
           'despues', jsonb_build_object('activo', FALSE),
           'motivo', 'Saneamiento de configuración previo al primer cutover'
       ), NULL, NULL
FROM cambio CROSS JOIN actor;

WITH actor AS (
    SELECT username FROM fg_usuario
    WHERE perfil_id = 'SISTEMAS' AND estado = TRUE
    ORDER BY username LIMIT 1
), cambio AS (
    UPDATE fg_producto_facturacion
    SET activo = FALSE, fecha_modificacion = CURRENT_TIMESTAMP
    WHERE codigo_sku = '12345' AND activo = TRUE
    RETURNING id, codigo_sku, descripcion
)
INSERT INTO fg_auditoria_config
    (username, entidad, accion, identificador, detalles, planta_key, ip_direccion)
SELECT actor.username, 'PRODUCTO_FACTURACION', 'DESACTIVAR_PRODUCTO_DEMOSTRATIVO', cambio.id::text,
       jsonb_build_object(
           'sku', cambio.codigo_sku,
           'descripcion', cambio.descripcion,
           'antes', jsonb_build_object('activo', TRUE),
           'despues', jsonb_build_object('activo', FALSE),
           'motivo', 'Saneamiento de configuración previo al primer cutover'
       ), NULL, NULL
FROM cambio CROSS JOIN actor;

-- Salvaguarda explícita: el servicio y sus tarifas sobreviven, pero no pueden
-- volver al alcance operativo por datos residuales de prueba.
UPDATE fg_servicio
SET activo = FALSE
WHERE codigo = 'SSS' AND activo = TRUE;

UPDATE fg_tarifa
SET activo = FALSE
WHERE servicio_id IN (SELECT id FROM fg_servicio WHERE codigo = 'SSS')
  AND activo = TRUE;

COMMIT;
