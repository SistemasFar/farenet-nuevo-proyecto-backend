-- =====================================================================
-- Metadatos del maestro DMS de Series en fg_serie_comprobante
-- =====================================================================
-- Objetivo
--   fg_serie_comprobante es el maestro ÚNICO de series: lo consumen la
--   facturación, las notas de crédito, las notas de débito, Nubefact y la
--   selección de sede. NO se crea una segunda fuente de verdad.
--
--   El maestro DMS de series trae 14 columnas. Nueve ya tienen representación
--   exacta en esta tabla; seis no la tenían:
--     - Nombre (FE / BE / NCF / NCB / NDF / NDB)
--     - Código del Local
--     - Nombre del Local
--     - Teléfono del Local
--     - Correo del Local
--     - Dirección Comercial
--
-- Garantías de ESTA migración
--   - SOLO ADD COLUMN IF NOT EXISTS. Ninguna columna existente se modifica.
--   - Ningún FK, índice, constraint ni dato actual se toca.
--   - Todas las columnas nuevas son NULLABLE: las series históricas (las 212
--     que ya existen) siguen funcionando exactamente igual, con NULL en el
--     metadato DMS que no tengan.
--   - No se agrega ninguna FK: estas columnas son texto de origen del DMS,
--     no relaciones. La relación real serie -> sede sigue siendo
--     `planta_key -> fg_planta(key)`, que ya existe y no se modifica.
--   - No se altera el contrato de facturación: `resolverSerieFaregas` y
--     `reservarSiguienteNumeroSerie` no leen estas columnas.
-- =====================================================================

BEGIN;

ALTER TABLE fg_serie_comprobante
    ADD COLUMN IF NOT EXISTS nombre_dms              VARCHAR(30),
    ADD COLUMN IF NOT EXISTS codigo_local_dms        VARCHAR(10),
    ADD COLUMN IF NOT EXISTS nombre_local_dms        VARCHAR(80),
    ADD COLUMN IF NOT EXISTS telefono_local_dms      VARCHAR(30),
    ADD COLUMN IF NOT EXISTS correo_local_dms        VARCHAR(120),
    ADD COLUMN IF NOT EXISTS direccion_comercial_dms VARCHAR(200);

COMMIT;
