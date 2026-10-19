BEGIN;

DO $$
BEGIN
    IF EXISTS (
        SELECT ruc FROM fg_empresa
        WHERE ruc IS NOT NULL
        GROUP BY ruc HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION 'Existen empresas FAREGAS con RUC duplicado.';
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_fg_empresa_ruc
    ON fg_empresa (ruc)
    WHERE ruc IS NOT NULL;

COMMIT;
