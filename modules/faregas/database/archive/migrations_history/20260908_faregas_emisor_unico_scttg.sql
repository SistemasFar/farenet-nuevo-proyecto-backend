BEGIN;

-- Decisión tributaria confirmada para el módulo FAREGAS:
-- todas las sedes presentes en la exportación productiva DMS de FAREGAS
-- emiten con SCTTG (RUC 20521536463). Los números de comprobante no se
-- modifican en esta migración; se reconfirman únicamente durante el cutover.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM fg_empresa WHERE key = 'FAREGAS') THEN
        RAISE EXCEPTION 'No existe la empresa técnica FAREGAS.';
    END IF;

    IF EXISTS (
        SELECT 1 FROM fg_empresa
        WHERE ruc = '20521536463' AND key <> 'FAREGAS'
    ) THEN
        RAISE EXCEPTION 'El RUC 20521536463 ya pertenece a otra empresa.';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM (VALUES
            ('190'), ('18'), ('140'), ('139'), ('13'), ('150'),
            ('25'), ('201'), ('61'), ('290'), ('138'), ('102'),
            ('292'), ('98'), ('160'), ('133'), ('180'), ('103')
        ) AS alcance(planta_key)
        LEFT JOIN fg_planta p ON p.key = alcance.planta_key
        WHERE p.key IS NULL
    ) THEN
        RAISE EXCEPTION 'Falta una sede del alcance productivo DMS FAREGAS.';
    END IF;
END $$;

UPDATE fg_empresa
SET nombre = 'SERVICIOS COMPLEMENTARIOS DE TRANSPORTE TERRESTRE Y GRUAS S.A.C.',
    ruc = '20521536463',
    fecha_modificacion = CURRENT_TIMESTAMP
WHERE key = 'FAREGAS'
  AND (nombre IS DISTINCT FROM 'SERVICIOS COMPLEMENTARIOS DE TRANSPORTE TERRESTRE Y GRUAS S.A.C.'
       OR ruc IS DISTINCT FROM '20521536463');

UPDATE fg_planta
SET empresa_key = 'FAREGAS'
WHERE key IN (
    '190', '18', '140', '139', '13', '150', '25', '201', '61',
    '290', '138', '102', '292', '98', '160', '133', '180', '103'
)
  AND empresa_key IS DISTINCT FROM 'FAREGAS';

-- Mantiene coherente el emisor de los snapshots de series DMS ya importados.
-- No cambia serie, último número, confirmación ni fecha de corte.
UPDATE fg_serie_comprobante
SET empresa_key = 'FAREGAS',
    fecha_modificacion = CURRENT_TIMESTAMP
WHERE planta_key IN (
    '190', '18', '140', '139', '13', '150', '25', '201', '61',
    '290', '138', '102', '292', '98', '160', '133', '180', '103'
)
  AND proveedor_emision = 'LEGACY'
  AND entorno_emision = 'PRODUCCION'
  AND empresa_key IS DISTINCT FROM 'FAREGAS';

INSERT INTO fg_empresa_facturador (
    empresa_key, proveedor, entorno, credencial_clave, activo
)
VALUES ('FAREGAS', 'NUBEFACT', 'PRODUCCION', 'FAREGAS', TRUE)
ON CONFLICT (empresa_key, proveedor, entorno)
DO UPDATE SET credencial_clave = EXCLUDED.credencial_clave,
              activo = TRUE,
              fecha_modificacion = CURRENT_TIMESTAMP;

COMMIT;
