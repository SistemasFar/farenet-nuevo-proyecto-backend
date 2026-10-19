BEGIN;

-- El taller GNV se determina por la sede estable del certificado. Los registros
-- heredados permanecen sin planta_key para no alterar certificados históricos.
ALTER TABLE fg_taller_autorizado
    ADD COLUMN IF NOT EXISTS planta_key varchar(20);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'fk_fg_taller_autorizado_planta'
          AND conrelid = 'fg_taller_autorizado'::regclass
    ) THEN
        ALTER TABLE fg_taller_autorizado
            ADD CONSTRAINT fk_fg_taller_autorizado_planta
            FOREIGN KEY (planta_key) REFERENCES fg_planta(key)
            ON UPDATE CASCADE ON DELETE RESTRICT;
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_fg_taller_autorizado_planta
    ON fg_taller_autorizado (planta_key)
    WHERE planta_key IS NOT NULL;

INSERT INTO fg_taller_autorizado (
    planta_key,
    razon_social,
    sede,
    estado
)
VALUES
    ('13',  'CHARING S.A.C. SEDE COLINA',             'COLINA',     true),
    ('98',  'CONVERTIGAS S.A.C. FAREGAS I SURCO',     'SURCO',      true),
    ('160', 'CHARING S.A.C. SEDE SURQUILLO',          'SURQUILLO',  true)
ON CONFLICT (planta_key) WHERE planta_key IS NOT NULL
DO UPDATE SET
    razon_social = EXCLUDED.razon_social,
    sede = EXCLUDED.sede,
    estado = true,
    fecha_modificacion = CURRENT_TIMESTAMP;

-- Esta marca permite que los documentos nuevos usen el taller resuelto por
-- sede sin cambiar el render legacy de certificados ya emitidos.
ALTER TABLE fg_certificado_gnv
    ADD COLUMN IF NOT EXISTS taller_planta_key varchar(20);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'fk_fg_certificado_gnv_taller_planta'
          AND conrelid = 'fg_certificado_gnv'::regclass
    ) THEN
        ALTER TABLE fg_certificado_gnv
            ADD CONSTRAINT fk_fg_certificado_gnv_taller_planta
            FOREIGN KEY (taller_planta_key) REFERENCES fg_planta(key)
            ON UPDATE CASCADE ON DELETE RESTRICT;
    END IF;
END $$;

COMMIT;
