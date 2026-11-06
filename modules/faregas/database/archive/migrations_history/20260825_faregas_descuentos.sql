BEGIN;

-- --------------------------------------------------
-- 1. fg_descuento (Campaña / Alianza)
-- --------------------------------------------------
CREATE TABLE IF NOT EXISTS fg_descuento (
    id BIGSERIAL PRIMARY KEY,
    codigo VARCHAR NOT NULL,
    nombre VARCHAR NOT NULL,
    tipo VARCHAR NOT NULL, -- ALIANZA, CUPON, PLACA
    empresa_aliada_ruc VARCHAR NULL,
    empresa_aliada_nombre VARCHAR NULL,
    tipo_calculo VARCHAR NOT NULL, -- MONTO, PORCENTAJE
    valor NUMERIC(14,2) NOT NULL,
    fecha_inicio TIMESTAMP WITHOUT TIME ZONE NOT NULL,
    fecha_fin TIMESTAMP WITHOUT TIME ZONE NOT NULL,
    planta_key VARCHAR NULL,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    usuario_creacion VARCHAR NOT NULL,
    fecha_creacion TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    usuario_modificacion VARCHAR NULL,
    fecha_modificacion TIMESTAMP WITHOUT TIME ZONE NULL,
    
    CONSTRAINT fk_fg_descuento_planta FOREIGN KEY (planta_key) REFERENCES fg_planta(key) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_fg_descuento_usu_crea FOREIGN KEY (usuario_creacion) REFERENCES fg_usuario(username) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_fg_descuento_usu_mod FOREIGN KEY (usuario_modificacion) REFERENCES fg_usuario(username) ON UPDATE CASCADE ON DELETE RESTRICT,
    
    CONSTRAINT chk_fg_descuento_fechas CHECK (fecha_fin >= fecha_inicio),
    CONSTRAINT chk_fg_descuento_valor CHECK (valor > 0),
    CONSTRAINT chk_fg_descuento_porcentaje CHECK (tipo_calculo = 'MONTO' OR (tipo_calculo = 'PORCENTAJE' AND valor <= 100)),
    CONSTRAINT chk_fg_descuento_tipo CHECK (tipo IN ('ALIANZA', 'CUPON', 'PLACA')),
    CONSTRAINT chk_fg_descuento_tipo_calculo CHECK (tipo_calculo IN ('MONTO', 'PORCENTAJE'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_fg_descuento_codigo_upper ON fg_descuento(UPPER(BTRIM(codigo)));

-- --------------------------------------------------
-- 2. fg_descuentocliente (Códigos o beneficios entregados)
-- --------------------------------------------------
CREATE TABLE IF NOT EXISTS fg_descuentocliente (
    id BIGSERIAL PRIMARY KEY,
    descuento_id BIGINT NOT NULL,
    codigo VARCHAR NOT NULL,
    tipo_documento VARCHAR NULL, -- DNI, RUC
    nro_documento VARCHAR NULL,
    placa VARCHAR NULL,
    fecha_inicio TIMESTAMP WITHOUT TIME ZONE NULL,
    fecha_fin TIMESTAMP WITHOUT TIME ZONE NULL,
    max_usos INTEGER NOT NULL DEFAULT 1,
    usos_realizados INTEGER NOT NULL DEFAULT 0,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    usuario_creacion VARCHAR NOT NULL,
    fecha_creacion TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    usuario_modificacion VARCHAR NULL,
    fecha_modificacion TIMESTAMP WITHOUT TIME ZONE NULL,

    CONSTRAINT fk_fg_descuentocliente_descuento FOREIGN KEY (descuento_id) REFERENCES fg_descuento(id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_fg_descuentocliente_usu_crea FOREIGN KEY (usuario_creacion) REFERENCES fg_usuario(username) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_fg_descuentocliente_usu_mod FOREIGN KEY (usuario_modificacion) REFERENCES fg_usuario(username) ON UPDATE CASCADE ON DELETE RESTRICT,

    CONSTRAINT chk_fg_descuentocliente_usos CHECK (max_usos > 0 AND usos_realizados >= 0 AND usos_realizados <= max_usos),
    CONSTRAINT chk_fg_descuentocliente_fechas CHECK ((fecha_inicio IS NULL AND fecha_fin IS NULL) OR (fecha_fin >= fecha_inicio)),
    CONSTRAINT chk_fg_descuentocliente_tipo_doc CHECK (tipo_documento IS NULL OR tipo_documento IN ('DNI', 'RUC'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_fg_descuentocliente_codigo_upper ON fg_descuentocliente(UPPER(BTRIM(codigo)));
CREATE INDEX IF NOT EXISTS idx_fg_descuentocliente_placa ON fg_descuentocliente(placa);
CREATE INDEX IF NOT EXISTS idx_fg_descuentocliente_doc ON fg_descuentocliente(nro_documento);

-- --------------------------------------------------
-- 3. fg_descuentodetalle (Servicios permitidos)
-- --------------------------------------------------
CREATE TABLE IF NOT EXISTS fg_descuentodetalle (
    id BIGSERIAL PRIMARY KEY,
    descuento_id BIGINT NOT NULL,
    servicio_id INTEGER NOT NULL,
    tipo_calculo VARCHAR NULL,
    valor NUMERIC(14,2) NULL,
    precio_minimo NUMERIC(14,2) NULL,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    usuario_creacion VARCHAR NOT NULL,
    fecha_creacion TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    usuario_modificacion VARCHAR NULL,
    fecha_modificacion TIMESTAMP WITHOUT TIME ZONE NULL,

    CONSTRAINT uq_fg_descuentodetalle_serv UNIQUE(descuento_id, servicio_id),
    CONSTRAINT fk_fg_descuentodetalle_descuento FOREIGN KEY (descuento_id) REFERENCES fg_descuento(id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_fg_descuentodetalle_servicio FOREIGN KEY (servicio_id) REFERENCES fg_servicio(id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_fg_descuentodetalle_usu_crea FOREIGN KEY (usuario_creacion) REFERENCES fg_usuario(username) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_fg_descuentodetalle_usu_mod FOREIGN KEY (usuario_modificacion) REFERENCES fg_usuario(username) ON UPDATE CASCADE ON DELETE RESTRICT,

    CONSTRAINT chk_fg_descuentodetalle_valor CHECK (valor IS NULL OR valor > 0),
    CONSTRAINT chk_fg_descuentodetalle_precio_min CHECK (precio_minimo IS NULL OR precio_minimo >= 0),
    CONSTRAINT chk_fg_descuentodetalle_porcentaje CHECK (tipo_calculo IS NULL OR (tipo_calculo = 'MONTO' OR (tipo_calculo = 'PORCENTAJE' AND valor <= 100))),
    CONSTRAINT chk_fg_descuentodetalle_tipo_calculo CHECK (tipo_calculo IS NULL OR tipo_calculo IN ('MONTO', 'PORCENTAJE'))
);

-- --------------------------------------------------
-- 4. fg_descuentocomprobante (Reserva y aplicación)
-- --------------------------------------------------
CREATE TABLE IF NOT EXISTS fg_descuentocomprobante (
    id BIGSERIAL PRIMARY KEY,
    descuento_cliente_id BIGINT NOT NULL,
    certificado_id BIGINT NOT NULL,
    orden_pago_id BIGINT NULL,
    facturacion_id BIGINT NULL,
    importe_original NUMERIC(14,2) NOT NULL,
    importe_descuento NUMERIC(14,2) NOT NULL,
    importe_final NUMERIC(14,2) NOT NULL,
    estado VARCHAR NOT NULL, -- RESERVADO, APLICADO, LIBERADO, ANULADO
    reservado_hasta TIMESTAMP WITHOUT TIME ZONE NOT NULL,
    fecha_aplicacion TIMESTAMP WITHOUT TIME ZONE NULL,
    usuario_creacion VARCHAR NOT NULL,
    fecha_creacion TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    usuario_modificacion VARCHAR NULL,
    fecha_modificacion TIMESTAMP WITHOUT TIME ZONE NULL,

    CONSTRAINT fk_fg_descom_descli FOREIGN KEY (descuento_cliente_id) REFERENCES fg_descuentocliente(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_fg_descom_cert FOREIGN KEY (certificado_id) REFERENCES fg_certificado(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_fg_descom_orden FOREIGN KEY (orden_pago_id) REFERENCES fg_orden_pago(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_fg_descom_fact FOREIGN KEY (facturacion_id) REFERENCES fg_facturacion(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_fg_descom_usu_crea FOREIGN KEY (usuario_creacion) REFERENCES fg_usuario(username) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_fg_descom_usu_mod FOREIGN KEY (usuario_modificacion) REFERENCES fg_usuario(username) ON UPDATE CASCADE ON DELETE RESTRICT,

    CONSTRAINT chk_fg_descom_estado CHECK (estado IN ('RESERVADO', 'APLICADO', 'LIBERADO', 'ANULADO')),
    CONSTRAINT chk_fg_descom_importes CHECK (importe_original >= importe_descuento AND importe_final = (importe_original - importe_descuento) AND importe_final >= 0)
);

CREATE INDEX IF NOT EXISTS idx_fg_descom_cert ON fg_descuentocomprobante(certificado_id);
CREATE INDEX IF NOT EXISTS idx_fg_descom_descli ON fg_descuentocomprobante(descuento_cliente_id);
CREATE INDEX IF NOT EXISTS idx_fg_descom_estado ON fg_descuentocomprobante(estado);
CREATE UNIQUE INDEX IF NOT EXISTS uq_fg_descom_certificado_activo
    ON fg_descuentocomprobante(certificado_id)
    WHERE estado IN ('RESERVADO', 'APLICADO');

-- --------------------------------------------------
-- PERMISOS
-- --------------------------------------------------
INSERT INTO fg_permiso (clave, nombre, modulo, descripcion, activo)
VALUES ('MENU_DESCUENTOS', 'Menú Descuentos', 'MENU', 'Acceso al menú de descuentos FAREGAS', TRUE)
ON CONFLICT (clave) DO NOTHING;

INSERT INTO fg_permiso (clave, nombre, modulo, descripcion, activo)
VALUES ('DESCUENTOS_ADMINISTRAR', 'Administrar Descuentos', 'FAREGAS', 'Permite crear y modificar campañas de descuentos FAREGAS', TRUE)
ON CONFLICT (clave) DO NOTHING;

INSERT INTO fg_perfil_permiso (perfil_clave, permiso_clave)
SELECT p.clave, 'MENU_DESCUENTOS' FROM fg_perfil p WHERE p.clave = 'SISTEMAS'
ON CONFLICT DO NOTHING;

INSERT INTO fg_perfil_permiso (perfil_clave, permiso_clave)
SELECT p.clave, 'DESCUENTOS_ADMINISTRAR' FROM fg_perfil p WHERE p.clave = 'SISTEMAS'
ON CONFLICT DO NOTHING;

COMMIT;
