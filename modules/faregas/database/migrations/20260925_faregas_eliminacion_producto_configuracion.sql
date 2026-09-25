-- 20260925_faregas_eliminacion_producto_configuracion.sql
-- Limpieza temporal y explícita del producto fiscal desde el servicio de
-- configuración. No se modifica ninguna FK ni se activa cascada global.
--
-- El detalle de operación conserva sus snapshots comerciales. Este cambio
-- únicamente permite que un detalle histórico conserve ese snapshot cuando
-- el servicio de eliminación retira las FK al producto y a la tarifa vivos.

BEGIN;

ALTER TABLE fg_operacion_detalle
    DROP CONSTRAINT IF EXISTS ck_fg_operacion_detalle_concepto;

ALTER TABLE fg_operacion_detalle
    ADD CONSTRAINT ck_fg_operacion_detalle_concepto CHECK (
        (
            tipo_item = 'PRODUCTO'
            AND servicio_id IS NULL
            AND tarifa_id IS NULL
            AND certificado_id IS NULL
            AND genera_certificado_snapshot = FALSE
            AND (
                producto_facturacion_id IS NOT NULL
                OR (
                    producto_facturacion_id IS NULL
                    AND codigo_sku_snapshot IS NOT NULL
                    AND descripcion_snapshot IS NOT NULL
                    AND unidad_snapshot IS NOT NULL
                    AND afectacion_igv_snapshot IS NOT NULL
                    AND valor_unitario IS NOT NULL
                    AND precio_unitario IS NOT NULL
                    AND base_imponible IS NOT NULL
                    AND igv IS NOT NULL
                    AND importe_total IS NOT NULL
                )
            )
        )
        OR
        (
            tipo_item = 'SERVICIO'
            AND servicio_id IS NOT NULL
            AND (
                tarifa_id IS NOT NULL
                OR (
                    tarifa_id IS NULL
                    AND codigo_sku_snapshot IS NOT NULL
                    AND descripcion_snapshot IS NOT NULL
                    AND unidad_snapshot IS NOT NULL
                    AND afectacion_igv_snapshot IS NOT NULL
                    AND valor_unitario IS NOT NULL
                    AND precio_unitario IS NOT NULL
                    AND base_imponible IS NOT NULL
                    AND igv IS NOT NULL
                    AND importe_total IS NOT NULL
                )
            )
            AND (
                (genera_certificado_snapshot = TRUE AND certificado_id IS NOT NULL)
                OR
                (genera_certificado_snapshot = FALSE AND certificado_id IS NULL)
            )
        )
    );

COMMIT;
