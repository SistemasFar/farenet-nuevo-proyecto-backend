BEGIN;

-- Preparación exclusivamente tributaria para Nubefact. Esta migración no
-- modifica los rangos ni los correlativos de certificados Faregas.
ALTER TABLE fg_serie_comprobante
    ADD COLUMN IF NOT EXISTS confirmada_produccion BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS numero_inicial_confirmado BIGINT NULL,
    ADD COLUMN IF NOT EXISTS sistema_origen VARCHAR(30) NULL,
    ADD COLUMN IF NOT EXISTS fecha_corte TIMESTAMP WITHOUT TIME ZONE NULL,
    ADD COLUMN IF NOT EXISTS usuario_confirmacion VARCHAR(255) NULL,
    ADD COLUMN IF NOT EXISTS fecha_confirmacion TIMESTAMP WITHOUT TIME ZONE NULL;

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
