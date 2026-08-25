BEGIN;

-- TAREA 9A: estructura neutral y compatible. No migra datos ni sustituye
-- certificado_id en las tablas financieras existentes.
CREATE TEMP TABLE fg_control_financiero_9a ON COMMIT DROP AS
SELECT
    (SELECT COUNT(*) FROM fg_orden_pago) AS orden_count,
    (SELECT COUNT(*) FROM fg_pago) AS pago_count,
    (SELECT COUNT(*) FROM fg_facturacion) AS facturacion_count,
    (SELECT COALESCE(SUM(importe_total), 0)::numeric FROM fg_orden_pago) AS orden_importe_total,
    (SELECT COALESCE(SUM(importe_pagado), 0)::numeric FROM fg_orden_pago) AS orden_importe_pagado,
    (SELECT COALESCE(SUM(saldo_pendiente), 0)::numeric FROM fg_orden_pago) AS orden_saldo,
    (SELECT COALESCE(SUM(importe), 0)::numeric FROM fg_pago) AS pago_importe,
    (SELECT COALESCE(SUM(importe_total), 0)::numeric FROM fg_facturacion) AS facturacion_importe,
    (
        SELECT COALESCE(jsonb_object_agg(estado, cantidad ORDER BY estado), '{}'::jsonb)
        FROM (SELECT estado, COUNT(*) AS cantidad FROM fg_orden_pago GROUP BY estado) estados
    ) AS orden_estados,
    (
        SELECT COALESCE(jsonb_object_agg(COALESCE(estado, '<NULL>'), cantidad ORDER BY COALESCE(estado, '<NULL>')), '{}'::jsonb)
        FROM (SELECT estado, COUNT(*) AS cantidad FROM fg_pago GROUP BY estado) estados
    ) AS pago_estados,
    (
        SELECT COALESCE(jsonb_object_agg(estado, cantidad ORDER BY estado), '{}'::jsonb)
        FROM (SELECT estado, COUNT(*) AS cantidad FROM fg_facturacion GROUP BY estado) estados
    ) AS facturacion_estados,
    (
        SELECT COUNT(*)
        FROM fg_pago p
        LEFT JOIN fg_orden_pago op ON op.id = p.orden_pago_id
        WHERE p.orden_pago_id IS NOT NULL AND op.id IS NULL
    ) AS pagos_huerfanos;

CREATE TABLE IF NOT EXISTS fg_operacion_comercial (
    id BIGSERIAL PRIMARY KEY,
    planta_key VARCHAR NOT NULL,
    cliente_id BIGINT NULL,
    tipo_documento_cliente_snapshot VARCHAR(20) NULL,
    documento_cliente_snapshot VARCHAR(20) NULL,
    nombre_cliente_snapshot VARCHAR(250) NULL,
    direccion_cliente_snapshot VARCHAR(500) NULL,
    placa VARCHAR(12) NULL,
    moneda_key VARCHAR NOT NULL DEFAULT 'sol',
    base_imponible NUMERIC(14,2) NOT NULL DEFAULT 0,
    igv NUMERIC(14,2) NOT NULL DEFAULT 0,
    importe_total NUMERIC(14,2) NOT NULL DEFAULT 0,
    estado VARCHAR(30) NOT NULL DEFAULT 'BORRADOR',
    usuario_creacion VARCHAR NOT NULL,
    fecha_creacion TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    usuario_modificacion VARCHAR NULL,
    fecha_modificacion TIMESTAMP WITHOUT TIME ZONE NULL,
    CONSTRAINT fk_fg_operacion_planta
        FOREIGN KEY (planta_key) REFERENCES fg_planta(key) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_fg_operacion_cliente
        FOREIGN KEY (cliente_id) REFERENCES fg_cliente(id) ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT fk_fg_operacion_moneda
        FOREIGN KEY (moneda_key) REFERENCES moneda(key) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_fg_operacion_usuario_creacion
        FOREIGN KEY (usuario_creacion) REFERENCES fg_usuario(username) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_fg_operacion_usuario_modificacion
        FOREIGN KEY (usuario_modificacion) REFERENCES fg_usuario(username) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT ck_fg_operacion_estado
        CHECK (estado IN ('BORRADOR', 'PENDIENTE_PAGO', 'PAGADO', 'FACTURADO', 'ANULADO')),
    CONSTRAINT ck_fg_operacion_importes
        CHECK (base_imponible >= 0 AND igv >= 0 AND importe_total >= 0),
    CONSTRAINT ck_fg_operacion_placa
        CHECK (placa IS NULL OR BTRIM(placa) <> '')
);

CREATE TABLE IF NOT EXISTS fg_operacion_detalle (
    id BIGSERIAL PRIMARY KEY,
    operacion_id BIGINT NOT NULL,
    tipo_item VARCHAR(20) NOT NULL,
    servicio_id INTEGER NULL,
    tarifa_id INTEGER NULL,
    producto_facturacion_id BIGINT NULL,
    certificado_id BIGINT NULL,
    cantidad NUMERIC(12,3) NOT NULL,
    codigo_sku_snapshot VARCHAR(80) NULL,
    descripcion_snapshot VARCHAR(500) NOT NULL,
    unidad_snapshot VARCHAR(30) NOT NULL,
    afectacion_igv_snapshot VARCHAR(2) NOT NULL,
    codigo_sunat_snapshot VARCHAR(30) NULL,
    valor_unitario NUMERIC(14,6) NOT NULL,
    precio_unitario NUMERIC(14,6) NOT NULL,
    base_imponible NUMERIC(14,2) NOT NULL,
    igv NUMERIC(14,2) NOT NULL,
    importe_total NUMERIC(14,2) NOT NULL,
    genera_certificado_snapshot BOOLEAN NOT NULL DEFAULT FALSE,
    orden INTEGER NOT NULL,
    fecha_creacion TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_fg_operacion_detalle_operacion
        FOREIGN KEY (operacion_id) REFERENCES fg_operacion_comercial(id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_fg_operacion_detalle_servicio
        FOREIGN KEY (servicio_id) REFERENCES fg_servicio(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_fg_operacion_detalle_tarifa
        FOREIGN KEY (tarifa_id) REFERENCES fg_tarifa(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_fg_operacion_detalle_producto
        FOREIGN KEY (producto_facturacion_id) REFERENCES fg_producto_facturacion(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_fg_operacion_detalle_certificado
        FOREIGN KEY (certificado_id) REFERENCES fg_certificado(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT uq_fg_operacion_detalle_orden UNIQUE (operacion_id, orden),
    CONSTRAINT ck_fg_operacion_detalle_tipo CHECK (tipo_item IN ('SERVICIO', 'PRODUCTO')),
    CONSTRAINT ck_fg_operacion_detalle_cantidad CHECK (cantidad > 0),
    CONSTRAINT ck_fg_operacion_detalle_orden CHECK (orden > 0),
    CONSTRAINT ck_fg_operacion_detalle_importes
        CHECK (valor_unitario >= 0 AND precio_unitario >= 0 AND base_imponible >= 0 AND igv >= 0 AND importe_total >= 0),
    CONSTRAINT ck_fg_operacion_detalle_concepto CHECK (
        (
            tipo_item = 'PRODUCTO'
            AND producto_facturacion_id IS NOT NULL
            AND servicio_id IS NULL
            AND tarifa_id IS NULL
            AND certificado_id IS NULL
            AND genera_certificado_snapshot = FALSE
        )
        OR
        (
            tipo_item = 'SERVICIO'
            AND servicio_id IS NOT NULL
            AND tarifa_id IS NOT NULL
            AND (
                (genera_certificado_snapshot = TRUE AND certificado_id IS NOT NULL)
                OR
                (genera_certificado_snapshot = FALSE AND certificado_id IS NULL)
            )
        )
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_fg_operacion_detalle_certificado
    ON fg_operacion_detalle (certificado_id)
    WHERE certificado_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_fg_operacion_panel
    ON fg_operacion_comercial (planta_key, estado, fecha_creacion DESC, id DESC);

CREATE INDEX IF NOT EXISTS ix_fg_operacion_detalle_operacion
    ON fg_operacion_detalle (operacion_id, orden);

CREATE TABLE IF NOT EXISTS fg_producto_sede (
    id BIGSERIAL PRIMARY KEY,
    planta_key VARCHAR NOT NULL,
    producto_facturacion_id BIGINT NOT NULL,
    precio NUMERIC(14,2) NOT NULL,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    orden INTEGER NOT NULL DEFAULT 0,
    fecha_creacion TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_modificacion TIMESTAMP WITHOUT TIME ZONE NULL,
    CONSTRAINT fk_fg_producto_sede_planta
        FOREIGN KEY (planta_key) REFERENCES fg_planta(key) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_fg_producto_sede_producto
        FOREIGN KEY (producto_facturacion_id) REFERENCES fg_producto_facturacion(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT uq_fg_producto_sede UNIQUE (planta_key, producto_facturacion_id),
    CONSTRAINT ck_fg_producto_sede_precio CHECK (precio > 0),
    CONSTRAINT ck_fg_producto_sede_orden CHECK (orden >= 0)
);

CREATE INDEX IF NOT EXISTS ix_fg_producto_sede_catalogo
    ON fg_producto_sede (planta_key, activo, orden, producto_facturacion_id);

ALTER TABLE fg_orden_pago
    ADD COLUMN IF NOT EXISTS operacion_id BIGINT NULL;

ALTER TABLE fg_facturacion
    ADD COLUMN IF NOT EXISTS operacion_id BIGINT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_fg_orden_pago_operacion'
    ) THEN
        ALTER TABLE fg_orden_pago
            ADD CONSTRAINT fk_fg_orden_pago_operacion
            FOREIGN KEY (operacion_id) REFERENCES fg_operacion_comercial(id)
            ON UPDATE CASCADE ON DELETE RESTRICT;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_fg_facturacion_operacion'
    ) THEN
        ALTER TABLE fg_facturacion
            ADD CONSTRAINT fk_fg_facturacion_operacion
            FOREIGN KEY (operacion_id) REFERENCES fg_operacion_comercial(id)
            ON UPDATE CASCADE ON DELETE RESTRICT;
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_fg_orden_pago_operacion
    ON fg_orden_pago (operacion_id)
    WHERE operacion_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_fg_facturacion_operacion
    ON fg_facturacion (operacion_id)
    WHERE operacion_id IS NOT NULL;

DO $$
DECLARE
    antes JSONB;
    despues JSONB;
BEGIN
    SELECT TO_JSONB(control) INTO antes FROM fg_control_financiero_9a control;

    SELECT TO_JSONB(control) INTO despues
    FROM (
        SELECT
            (SELECT COUNT(*) FROM fg_orden_pago) AS orden_count,
            (SELECT COUNT(*) FROM fg_pago) AS pago_count,
            (SELECT COUNT(*) FROM fg_facturacion) AS facturacion_count,
            (SELECT COALESCE(SUM(importe_total), 0)::numeric FROM fg_orden_pago) AS orden_importe_total,
            (SELECT COALESCE(SUM(importe_pagado), 0)::numeric FROM fg_orden_pago) AS orden_importe_pagado,
            (SELECT COALESCE(SUM(saldo_pendiente), 0)::numeric FROM fg_orden_pago) AS orden_saldo,
            (SELECT COALESCE(SUM(importe), 0)::numeric FROM fg_pago) AS pago_importe,
            (SELECT COALESCE(SUM(importe_total), 0)::numeric FROM fg_facturacion) AS facturacion_importe,
            (
                SELECT COALESCE(jsonb_object_agg(estado, cantidad ORDER BY estado), '{}'::jsonb)
                FROM (SELECT estado, COUNT(*) AS cantidad FROM fg_orden_pago GROUP BY estado) estados
            ) AS orden_estados,
            (
                SELECT COALESCE(jsonb_object_agg(COALESCE(estado, '<NULL>'), cantidad ORDER BY COALESCE(estado, '<NULL>')), '{}'::jsonb)
                FROM (SELECT estado, COUNT(*) AS cantidad FROM fg_pago GROUP BY estado) estados
            ) AS pago_estados,
            (
                SELECT COALESCE(jsonb_object_agg(estado, cantidad ORDER BY estado), '{}'::jsonb)
                FROM (SELECT estado, COUNT(*) AS cantidad FROM fg_facturacion GROUP BY estado) estados
            ) AS facturacion_estados,
            (
                SELECT COUNT(*)
                FROM fg_pago p
                LEFT JOIN fg_orden_pago op ON op.id = p.orden_pago_id
                WHERE p.orden_pago_id IS NOT NULL AND op.id IS NULL
            ) AS pagos_huerfanos
    ) control;

    IF antes IS DISTINCT FROM despues THEN
        RAISE EXCEPTION 'CONTROL_FINANCIERO_9A_FALLIDO. Antes: %, Después: %', antes, despues;
    END IF;
END $$;

COMMIT;
