BEGIN;

INSERT INTO public.fg_permiso (clave, nombre, modulo, descripcion, activo)
VALUES (
    'FAREGAS_NOTIFICACION_CORTESIA_RECIBIR',
    'Recibir notificaciones de cortesías',
    'FAREGAS',
    'Recibe avisos informativos cuando se emite una cortesía en una sede autorizada. No autoriza a emitir cortesías.',
    TRUE
)
ON CONFLICT (clave) DO UPDATE
SET nombre = EXCLUDED.nombre,
    modulo = EXCLUDED.modulo,
    descripcion = EXCLUDED.descripcion,
    activo = EXCLUDED.activo;

INSERT INTO public.fg_descuento (
    codigo, nombre, tipo, tipo_calculo, valor,
    fecha_inicio, fecha_fin, activo, usuario_creacion
)
SELECT
    'CORTESIA_FAREGAS',
    'CORTESÍA FAREGAS',
    'PROMOCION',
    'PORCENTAJE',
    100,
    TIMESTAMP '2020-01-01 00:00:00',
    TIMESTAMP '2099-12-31 23:59:59',
    TRUE,
    'MIGRACION_FAREGAS'
WHERE NOT EXISTS (
    SELECT 1
    FROM public.fg_descuento
    WHERE UPPER(BTRIM(codigo)) = 'CORTESIA_FAREGAS'
);

UPDATE public.fg_descuento
SET nombre = 'CORTESÍA FAREGAS',
    tipo = 'PROMOCION',
    tipo_calculo = 'PORCENTAJE',
    valor = 100,
    activo = TRUE,
    fecha_modificacion = CURRENT_TIMESTAMP,
    usuario_modificacion = 'MIGRACION_FAREGAS'
WHERE UPPER(BTRIM(codigo)) = 'CORTESIA_FAREGAS';

COMMIT;
