BEGIN;

-- ---------------------------------------------------------------------------
-- Observaciones del certificado GNV
--
-- El formulario de "Información específica: GNV" ya recogía OBSERVACIONES y la
-- plantilla gnv-anual.template.js ya las imprimía, pero el dato no tenía dónde
-- persistir: fg_certificado_gnv no tenía columna y guardarGNV no la escribía.
-- El texto se perdía al guardar y llegaba vacío a la previsualización.
--
-- Esta migración sólo agrega la columna. No modifica registros existentes: los
-- certificados ya guardados quedan con NULL, que es el valor de "sin
-- observación", y el template ya sabe imprimir el texto de puntos cuando falta.
--
-- Es idempotente: se puede volver a ejecutar sin efecto.
-- ---------------------------------------------------------------------------

ALTER TABLE fg_certificado_gnv
    ADD COLUMN IF NOT EXISTS observaciones character varying(250);

COMMENT ON COLUMN fg_certificado_gnv.observaciones IS
    'Observaciones del certificado GNV escritas por el inspector. Opcional. Limite 250 caracteres.';

COMMIT;
