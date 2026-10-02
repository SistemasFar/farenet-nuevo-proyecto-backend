-- ===========================================================================
-- CORRELATIVOS DE CERTIFICADO POR SEDE
--
-- Por qué este cambio
-- ------------------
-- El modelo anterior identificaba un rango por la terna
-- (planta_key, tipo_certificado_clave, modalidad). Eso obligaba a que CADA
-- producto, tipo o modalidad tuviera su propio contador dentro de la misma
-- sede, y la restricción de exclusión sólo cubría el solapamiento DENTRO de
-- una familia (tipo_certificado_clave WITH =). Consecuencia medida: 22 pares
-- de sedes con la misma franja de números físicos asignada a la vez.
--
-- La realidad física es otra. El proveedor entrega bloques de números; se
-- reparten entre sedes; cada sede consume el suyo; cuando se agota, recibe
-- otro. El tipo de certificado, la modalidad y el producto NO participan: no
-- son parte de la clave y no deben serlo.
--
-- Este archivo es la definición del inventario por sede. La carga de datos y
-- cualquier migración desde el modelo anterior van aparte, y deben poder
-- detenerse en los casos con solapamiento sin inventar números.
--
-- Lo que NO se toca aquí: correlativos tributarios, series de comprobante,
-- Nubefact, productos fiscales, tarifas, pagos, chips o formatos.
-- ===========================================================================

CREATE TABLE fg_correlativo_certificado_sede (
    id                bigserial PRIMARY KEY,
    planta_key        varchar NOT NULL REFERENCES fg_planta (key),

    -- Rango físico recibido por la sede. Desde/Hasta en la interfaz.
    rango_inicio      bigint  NOT NULL,
    rango_fin         bigint  NOT NULL,

    -- Último número entregado. Nace en rango_inicio - 1 porque el rango es
    -- nuevo y todavía no entregó nada: eso NO es retroceder un correlativo
    -- usado. Nunca se resetea y nunca retrocede.
    numero_actual     bigint  NOT NULL,

    -- Derivadas, no duplicables a mano.
    cantidad          bigint GENERATED ALWAYS AS (rango_fin - rango_inicio + 1) STORED,
    disponibles       bigint GENERATED ALWAYS AS (rango_fin - numero_actual) STORED,

    estado            varchar NOT NULL DEFAULT 'ACTIVO',
    fecha_asignacion  timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_cierre      timestamp,
    observacion       varchar(500),
    fecha_creacion    timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_modificacion timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- Un rango va de 1 a 50 números. No hay tamaño fijo de 100: los bloques
    -- físicos reales vienen en tamaños variables y el operador los recibe.
    CONSTRAINT chk_corr_sede_cantidad
        CHECK (rango_fin - rango_inicio + 1 BETWEEN 1 AND 50),

    CONSTRAINT chk_corr_sede_desde
        CHECK (rango_inicio > 0),

    CONSTRAINT chk_corr_sede_hasta
        CHECK (rango_fin >= rango_inicio),

    -- El consumo no puede salirse del rango ni retroceder.
    CONSTRAINT chk_corr_sede_actual
        CHECK (numero_actual >= rango_inicio - 1 AND numero_actual <= rango_fin),

    -- AGOTADO es un hecho de consumo: sólo si no queda ni un número, y sin
    -- fecha de cierre (nadie decidió cerrarlo, se vació solo).
    CONSTRAINT chk_corr_sede_agotado_coherente
        CHECK (estado <> 'AGOTADO' OR numero_actual >= rango_fin),
    CONSTRAINT chk_corr_sede_agotado_sin_cierre
        CHECK (estado <> 'AGOTADO' OR fecha_cierre IS NULL),

    -- CERRADO es una decisión del administrador y lleva su sello.
    CONSTRAINT chk_corr_sede_cierre
        CHECK (estado <> 'CERRADO' OR fecha_cierre IS NOT NULL),

    CONSTRAINT chk_corr_sede_estado
        CHECK (estado IN ('ACTIVO', 'AGOTADO', 'CERRADO'))
);

-- Los números físicos son únicos. Sin columna de tipo: la restricción es
-- GLOBAL. Un rango no puede solaparse ni dentro de una misma sede ni con el de
-- otra sede.
ALTER TABLE fg_correlativo_certificado_sede
    ADD CONSTRAINT excl_fg_corr_sede_rango
    EXCLUDE USING gist (int8range(rango_inicio, rango_fin, '[]') WITH &&);

-- Una sola fuente por sede mientras queda rango activo. Cuando se agota se
-- marca AGOTADO y recién entonces se puede agregar el siguiente bloque; no se
-- amplía ni se reinicia el anterior.
CREATE UNIQUE INDEX uk_fg_corr_sede_activo
    ON fg_correlativo_certificado_sede (planta_key)
    WHERE estado = 'ACTIVO';

-- Consumo: el rango activo de la sede. El índice parcial cubre el filtro.
CREATE INDEX idx_fg_corr_sede_consumo
    ON fg_correlativo_certificado_sede (planta_key)
    WHERE estado = 'ACTIVO';

-- Listado e historial por sede.
CREATE INDEX idx_fg_corr_sede_planta
    ON fg_correlativo_certificado_sede (planta_key, rango_inicio);

CREATE INDEX idx_fg_corr_sede_estado
    ON fg_correlativo_certificado_sede (estado, fecha_asignacion);