BEGIN;

-- Las series siguen siendo administrativas/no productivas. Esta ampliación
-- no modifica seriedocumentobase ni reserva correlativos reales.
ALTER TABLE fg_serie_comprobante
    DROP CONSTRAINT IF EXISTS chk_fg_serie_comprobante_tipo;

ALTER TABLE fg_serie_comprobante
    ADD CONSTRAINT chk_fg_serie_comprobante_tipo
    CHECK (tipo_comprobante IN ('FACTURA', 'BOLETA', 'NOTA_CREDITO', 'NOTA_DEBITO'));

CREATE TABLE IF NOT EXISTS fg_credito (
    id BIGSERIAL PRIMARY KEY,
    planta_key VARCHAR NOT NULL,
    facturacion_id BIGINT NOT NULL,
    serie_comprobante_id BIGINT NULL,
    motivo_codigo VARCHAR(10) NULL,
    sustento TEXT NULL,
    serie VARCHAR(30) NULL,
    numero BIGINT NULL,
    nro_comprobante VARCHAR(80) NULL,
    moneda_key VARCHAR NOT NULL DEFAULT 'sol',
    base_imponible NUMERIC(14,2) NOT NULL DEFAULT 0,
    igv NUMERIC(14,2) NOT NULL DEFAULT 0,
    importe_total NUMERIC(14,2) NOT NULL DEFAULT 0,
    estado VARCHAR(20) NOT NULL DEFAULT 'BORRADOR',
    proveedor VARCHAR(30) NOT NULL DEFAULT 'NUBEFACT',
    aceptada_sunat BOOLEAN NULL,
    respuesta_proveedor JSONB NULL,
    usuario_creacion VARCHAR NOT NULL,
    fecha_creacion TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    usuario_modificacion VARCHAR NULL,
    fecha_modificacion TIMESTAMP WITHOUT TIME ZONE NULL,
    CONSTRAINT fk_fg_credito_planta
        FOREIGN KEY (planta_key) REFERENCES fg_planta(key) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_fg_credito_facturacion
        FOREIGN KEY (facturacion_id) REFERENCES fg_facturacion(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_fg_credito_serie
        FOREIGN KEY (serie_comprobante_id) REFERENCES fg_serie_comprobante(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_fg_credito_moneda
        FOREIGN KEY (moneda_key) REFERENCES moneda(key) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_fg_credito_usuario_creacion
        FOREIGN KEY (usuario_creacion) REFERENCES fg_usuario(username) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_fg_credito_usuario_modificacion
        FOREIGN KEY (usuario_modificacion) REFERENCES fg_usuario(username) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT ck_fg_credito_estado
        CHECK (estado IN ('BORRADOR', 'PENDIENTE', 'ACEPTADO', 'RECHAZADO', 'ERROR', 'ANULADO')),
    CONSTRAINT ck_fg_credito_importes
        CHECK (base_imponible >= 0 AND igv >= 0 AND importe_total >= 0),
    CONSTRAINT ck_fg_credito_numero
        CHECK (numero IS NULL OR numero > 0)
);

CREATE TABLE IF NOT EXISTS fg_debito (
    id BIGSERIAL PRIMARY KEY,
    planta_key VARCHAR NOT NULL,
    facturacion_id BIGINT NOT NULL,
    serie_comprobante_id BIGINT NULL,
    motivo_codigo VARCHAR(10) NULL,
    sustento TEXT NULL,
    serie VARCHAR(30) NULL,
    numero BIGINT NULL,
    nro_comprobante VARCHAR(80) NULL,
    moneda_key VARCHAR NOT NULL DEFAULT 'sol',
    base_imponible NUMERIC(14,2) NOT NULL DEFAULT 0,
    igv NUMERIC(14,2) NOT NULL DEFAULT 0,
    importe_total NUMERIC(14,2) NOT NULL DEFAULT 0,
    estado VARCHAR(20) NOT NULL DEFAULT 'BORRADOR',
    proveedor VARCHAR(30) NOT NULL DEFAULT 'NUBEFACT',
    aceptada_sunat BOOLEAN NULL,
    respuesta_proveedor JSONB NULL,
    usuario_creacion VARCHAR NOT NULL,
    fecha_creacion TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    usuario_modificacion VARCHAR NULL,
    fecha_modificacion TIMESTAMP WITHOUT TIME ZONE NULL,
    CONSTRAINT fk_fg_debito_planta
        FOREIGN KEY (planta_key) REFERENCES fg_planta(key) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_fg_debito_facturacion
        FOREIGN KEY (facturacion_id) REFERENCES fg_facturacion(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_fg_debito_serie
        FOREIGN KEY (serie_comprobante_id) REFERENCES fg_serie_comprobante(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_fg_debito_moneda
        FOREIGN KEY (moneda_key) REFERENCES moneda(key) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_fg_debito_usuario_creacion
        FOREIGN KEY (usuario_creacion) REFERENCES fg_usuario(username) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_fg_debito_usuario_modificacion
        FOREIGN KEY (usuario_modificacion) REFERENCES fg_usuario(username) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT ck_fg_debito_estado
        CHECK (estado IN ('BORRADOR', 'PENDIENTE', 'ACEPTADO', 'RECHAZADO', 'ERROR', 'ANULADO')),
    CONSTRAINT ck_fg_debito_importes
        CHECK (base_imponible >= 0 AND igv >= 0 AND importe_total >= 0),
    CONSTRAINT ck_fg_debito_numero
        CHECK (numero IS NULL OR numero > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_fg_credito_serie_numero
    ON fg_credito (planta_key, serie, numero)
    WHERE serie IS NOT NULL AND numero IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_fg_debito_serie_numero
    ON fg_debito (planta_key, serie, numero)
    WHERE serie IS NOT NULL AND numero IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_fg_credito_facturacion
    ON fg_credito (facturacion_id, fecha_creacion DESC);

CREATE INDEX IF NOT EXISTS ix_fg_debito_facturacion
    ON fg_debito (facturacion_id, fecha_creacion DESC);

COMMIT;
