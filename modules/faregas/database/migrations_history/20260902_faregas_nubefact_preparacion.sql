BEGIN;

-- Preparación exclusivamente tributaria para Nubefact. Esta migración no
-- modifica los rangos ni los correlativos de certificados Faregas.
ALTER TABLE fg_serie_comprobante
    ADD COLUMN IF NOT EXISTS empresa_key VARCHAR NULL,
    ADD COLUMN IF NOT EXISTS proveedor_emision VARCHAR(30) NOT NULL DEFAULT 'LEGACY',
    ADD COLUMN IF NOT EXISTS entorno_emision VARCHAR(15) NOT NULL DEFAULT 'DEMO',
    ADD COLUMN IF NOT EXISTS confirmada_produccion BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS numero_inicial_confirmado BIGINT NULL,
    ADD COLUMN IF NOT EXISTS sistema_origen VARCHAR(30) NULL,
    ADD COLUMN IF NOT EXISTS fecha_corte TIMESTAMP WITHOUT TIME ZONE NULL,
    ADD COLUMN IF NOT EXISTS usuario_confirmacion VARCHAR(255) NULL,
    ADD COLUMN IF NOT EXISTS fecha_confirmacion TIMESTAMP WITHOUT TIME ZONE NULL;

-- Las filas existentes quedan marcadas explícitamente como LEGACY. Ninguna se
-- convierte automáticamente a Nubefact ni se altera su correlativo.
UPDATE fg_serie_comprobante s
SET empresa_key = p.empresa_key
FROM fg_planta p
WHERE p.key = s.planta_key
  AND s.empresa_key IS NULL;

ALTER TABLE fg_serie_comprobante
    DROP CONSTRAINT IF EXISTS ck_fg_serie_proveedor_emision,
    DROP CONSTRAINT IF EXISTS ck_fg_serie_entorno_emision;
ALTER TABLE fg_serie_comprobante
    ADD CONSTRAINT ck_fg_serie_proveedor_emision
        CHECK (proveedor_emision IN ('LEGACY', 'NUBEFACT')),
    ADD CONSTRAINT ck_fg_serie_entorno_emision
        CHECK (entorno_emision IN ('DEMO', 'PRODUCCION'));

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_fg_serie_empresa'
    ) THEN
        ALTER TABLE fg_serie_comprobante
            ADD CONSTRAINT fk_fg_serie_empresa
            FOREIGN KEY (empresa_key) REFERENCES fg_empresa(key)
            ON UPDATE CASCADE ON DELETE RESTRICT;
    END IF;
END $$;

-- Una serie predeterminada se elige por sede, documento, proveedor y entorno.
-- Así DEMO y PRODUCCIÓN nunca comparten accidentalmente el mismo contador.
DROP INDEX IF EXISTS uk_fg_serie_comprobante_predeterminada_activa;
CREATE UNIQUE INDEX uk_fg_serie_comprobante_predeterminada_activa
    ON fg_serie_comprobante (
        planta_key, tipo_comprobante, proveedor_emision, entorno_emision
    )
    WHERE activo = TRUE AND es_predeterminada = TRUE;

-- Dentro de una empresa, una serie Nubefact es exclusiva y no se puede volver
-- a declarar en otra sede o ambiente, aun cuando luego sea desactivada.
CREATE UNIQUE INDEX IF NOT EXISTS uq_fg_serie_nubefact_empresa_documento
    ON fg_serie_comprobante (empresa_key, tipo_comprobante, serie)
    WHERE proveedor_emision = 'NUBEFACT';

-- Prepara la referencia productiva por empresa sin copiar secretos. La fila no
-- activa el envío: los seguros del backend y las variables de entorno continúan
-- cerrados hasta el pase formal.
INSERT INTO fg_empresa_facturador (
    empresa_key, proveedor, entorno, credencial_clave, activo
)
SELECT empresa_key, proveedor, 'PRODUCCION', credencial_clave, TRUE
FROM fg_empresa_facturador
WHERE proveedor = 'NUBEFACT' AND entorno = 'DEMO'
ON CONFLICT (empresa_key, proveedor, entorno) DO NOTHING;

ALTER TABLE fg_serie_comprobante
    DROP CONSTRAINT IF EXISTS ck_fg_serie_numero_inicial_confirmado;
ALTER TABLE fg_serie_comprobante
    ADD CONSTRAINT ck_fg_serie_numero_inicial_confirmado
    CHECK (numero_inicial_confirmado IS NULL OR numero_inicial_confirmado >= 0);

ALTER TABLE fg_facturacion
    ADD COLUMN IF NOT EXISTS serie_comprobante_id BIGINT NULL,
    ADD COLUMN IF NOT EXISTS fecha_reserva_correlativo TIMESTAMP WITHOUT TIME ZONE NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_fg_facturacion_serie_comprobante'
    ) THEN
        ALTER TABLE fg_facturacion
            ADD CONSTRAINT fk_fg_facturacion_serie_comprobante
            FOREIGN KEY (serie_comprobante_id) REFERENCES fg_serie_comprobante(id)
            ON UPDATE CASCADE ON DELETE RESTRICT;
    END IF;
END $$;

-- Una empresa no puede reutilizar el mismo número tributario. El índice se
-- aplica sólo a filas que ya tienen una reserva, por lo que no afecta borradores.
CREATE UNIQUE INDEX IF NOT EXISTS uq_fg_facturacion_comprobante_tributario
    ON fg_facturacion (empresa_key, tipo_comprobante, serie, numero)
    WHERE empresa_key IS NOT NULL AND serie IS NOT NULL AND numero IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_fg_facturacion_pendiente_monitoreo
    ON fg_facturacion (estado, fecha_ultimo_intento)
    WHERE estado IN ('PENDIENTE', 'ERROR', 'RECHAZADO');

COMMIT;
