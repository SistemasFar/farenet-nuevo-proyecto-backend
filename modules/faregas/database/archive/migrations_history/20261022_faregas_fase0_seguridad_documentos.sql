BEGIN;

-- FASE 0: separar la autorización de navegación de las operaciones fiscales
-- sensibles. La migración es idempotente y no modifica comprobantes,
-- certificados, pagos ni correlativos.
INSERT INTO fg_permiso (clave, nombre, modulo, descripcion, activo)
VALUES
    (
        'FAREGAS_ANULAR_COMPROBANTE',
        'Anular comprobante electrónico FAREGAS',
        'FAREGAS',
        'Permite iniciar la baja fiscal de comprobantes electrónicos FAREGAS; no anula certificados técnicos ni devuelve pagos.',
        TRUE
    ),
    (
        'FAREGAS_NOTA_CREDITO',
        'Emitir nota de crédito FAREGAS',
        'FAREGAS',
        'Permite emitir notas de crédito vinculadas a comprobantes FAREGAS.',
        TRUE
    )
ON CONFLICT (clave) DO UPDATE
SET nombre = EXCLUDED.nombre,
    modulo = EXCLUDED.modulo,
    descripcion = EXCLUDED.descripcion,
    activo = EXCLUDED.activo;

-- El perfil técnico conserva las capacidades de recuperación y soporte. Los
-- demás perfiles administrativos pueden recibirlas desde Configuración >
-- Perfiles, respetando las sedes que ya tienen asignadas.
INSERT INTO fg_perfil_permiso (perfil_clave, permiso_clave)
SELECT perfil.clave, permiso.clave
FROM fg_perfil perfil
CROSS JOIN (
    VALUES
        ('FAREGAS_ANULAR_COMPROBANTE'::varchar),
        ('FAREGAS_NOTA_CREDITO'::varchar)
) permiso(clave)
WHERE perfil.clave = 'SISTEMAS'
ON CONFLICT (perfil_clave, permiso_clave) DO NOTHING;

-- Un operador de caja no recibe privilegios fiscales administrativos por
-- defecto. Sólo se eliminan estas dos capacidades; su menú, sedes y demás
-- permisos permanecen intactos.
DELETE FROM fg_perfil_permiso
WHERE perfil_clave = 'OPERADOR'
  AND permiso_clave IN ('FAREGAS_ANULAR_COMPROBANTE', 'FAREGAS_NOTA_CREDITO');

COMMIT;
