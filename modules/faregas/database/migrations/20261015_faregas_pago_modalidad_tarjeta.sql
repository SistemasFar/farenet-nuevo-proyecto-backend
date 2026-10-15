BEGIN;

-- La marca (VISA, MASTERCARD, etc.) continúa en tarjeta_key. Este atributo
-- guarda la modalidad real de la operación y pertenece al pago, no al
-- comprobante. Es nullable para conservar pagos históricos y medios que no
-- son tarjetas físicas (efectivo, depósito, Yape, Plin, Cuponidad).
ALTER TABLE fg_pago
    ADD COLUMN IF NOT EXISTS modalidad_tarjeta character varying(10);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'chk_fg_pago_modalidad_tarjeta'
          AND conrelid = 'fg_pago'::regclass
    ) THEN
        ALTER TABLE fg_pago
            ADD CONSTRAINT chk_fg_pago_modalidad_tarjeta
            CHECK (modalidad_tarjeta IS NULL OR modalidad_tarjeta IN ('DEBITO', 'CREDITO'));
    END IF;
END $$;

COMMIT;
