BEGIN;

-- No crea una relación nueva: completa la FK por sede que ya existe en
-- fg_producto_inventariable_sede. La columna precio se conserva intacta como
-- legado; las ventas nuevas leen fg_producto_facturacion.precio_referencia.
DO $$
DECLARE
    v_producto_inventariable_id BIGINT;
    v_colina_id BIGINT;
    v_surco_id BIGINT;
    v_surquillo_id BIGINT;
    v_actualizados INTEGER;
BEGIN
    SELECT id INTO STRICT v_producto_inventariable_id
    FROM fg_producto_inventariable
    WHERE codigo = 'CHIP' AND activo = TRUE;

    SELECT id INTO STRICT v_colina_id
    FROM fg_producto_facturacion
    WHERE codigo_sku = 'CHIP + PORTA CHIP - COLINA'
      AND activo = TRUE AND es_para_venta = TRUE
      AND precio_referencia > 0;

    SELECT id INTO STRICT v_surco_id
    FROM fg_producto_facturacion
    WHERE codigo_sku = 'CHIP + PORTA CHIP - SURCO'
      AND activo = TRUE AND es_para_venta = TRUE
      AND precio_referencia > 0;

    SELECT id INTO STRICT v_surquillo_id
    FROM fg_producto_facturacion
    WHERE codigo_sku = 'CHIP + PORTA CHIP - SURQUILLO'
      AND activo = TRUE AND es_para_venta = TRUE
      AND precio_referencia > 0;

    UPDATE fg_producto_inventariable_sede
    SET producto_facturacion_id = CASE planta_key
            WHEN '13' THEN v_colina_id
            WHEN '98' THEN v_surco_id
            WHEN '160' THEN v_surquillo_id
        END,
        activo = TRUE,
        stock_permitido = TRUE,
        venta_habilitada = TRUE,
        fecha_modificacion = CURRENT_TIMESTAMP
    WHERE producto_inventariable_id = v_producto_inventariable_id
      AND planta_key IN ('13', '98', '160');

    GET DIAGNOSTICS v_actualizados = ROW_COUNT;
    IF v_actualizados <> 3 THEN
        RAISE EXCEPTION 'Se esperaban 3 configuraciones operativas de CHIP y se encontraron %', v_actualizados;
    END IF;
END $$;

COMMIT;
