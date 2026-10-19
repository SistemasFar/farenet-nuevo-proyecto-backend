BEGIN;

-- Capacidad sensible separada del acceso al menú. En esta primera entrega se
-- concede al perfil técnico; después puede asignarse a perfiles autorizados.
INSERT INTO fg_permiso (clave, nombre, modulo, descripcion, activo)
VALUES (
    'FAREGAS_NOTA_CREDITO',
    'Emitir nota de crédito FAREGAS',
    'FAREGAS',
    'Permite emitir notas de crédito vinculadas a comprobantes FAREGAS',
    TRUE
)
ON CONFLICT (clave) DO UPDATE
SET nombre = EXCLUDED.nombre,
    modulo = EXCLUDED.modulo,
    descripcion = EXCLUDED.descripcion,
    activo = EXCLUDED.activo;

INSERT INTO fg_perfil_permiso (perfil_clave, permiso_clave)
SELECT 'SISTEMAS', 'FAREGAS_NOTA_CREDITO'
WHERE EXISTS (SELECT 1 FROM fg_perfil WHERE clave = 'SISTEMAS')
ON CONFLICT DO NOTHING;

-- Las series históricas de notas de la sede DEMO pasan a ser elegibles por
-- el motor NubeFact V2. El cambio no toca ninguna serie de PRODUCCIÓN.
UPDATE fg_serie_comprobante
SET proveedor_emision = 'NUBEFACT',
    sistema_origen = COALESCE(sistema_origen, 'FAREGAS_DEMO'),
    fecha_modificacion = CURRENT_TIMESTAMP
WHERE planta_key = '201'
  AND entorno_emision = 'DEMO'
  AND tipo_comprobante IN ('NOTA_CREDITO_FACTURA', 'NOTA_CREDITO_BOLETA')
  AND activo = TRUE
  AND es_predeterminada = TRUE
  AND proveedor_emision <> 'NUBEFACT';

COMMIT;
