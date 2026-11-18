-- ============================================================================
-- MIGRACIÓN INCREMENTAL: 009_actualizacion_masiva_spot_productos.sql
-- Sistema: FAREGAS
-- Objetivo: Actualización masiva de clasificación fiscal SPOT en fg_producto_facturacion.
--           231 Servicios (Código 037, 12%), 22 Bienes (No sujetos), 22 Pendientes de revisión (NULL).
-- Idempotencia: 100% seguro para re-ejecución por listas explícitas de IDs.
-- ============================================================================

BEGIN;
SET LOCAL lock_timeout = '3s';

-- 1. Actualización explícita de los 231 Servicios de Certificación e Inspección (Código 037, 12.00%)
UPDATE public.fg_producto_facturacion
SET 
    naturaleza_spot = 'SERVICIO',
    sujeto_detraccion = true,
    detraccion_codigo = '037',
    detraccion_porcentaje = 12.00,
    fecha_modificacion = CURRENT_TIMESTAMP
WHERE id IN (
    1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 21, 22, 23, 24, 26, 27, 28, 29, 
    30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 
    54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 70, 71, 72, 75, 76, 77, 78, 79, 80, 
    81, 82, 83, 85, 89, 90, 91, 92, 93, 94, 95, 96, 99, 100, 102, 104, 105, 106, 107, 108, 109, 110, 
    111, 112, 113, 114, 115, 116, 117, 118, 120, 121, 122, 123, 124, 125, 126, 127, 128, 129, 130, 
    134, 135, 136, 137, 138, 139, 140, 154, 155, 156, 163, 164, 165, 166, 167, 168, 169, 170, 171, 
    172, 173, 174, 175, 176, 177, 178, 179, 180, 181, 182, 183, 184, 185, 186, 187, 188, 189, 190, 
    191, 192, 193, 194, 195, 196, 197, 198, 199, 200, 201, 202, 203, 204, 205, 206, 207, 208, 209, 
    210, 211, 212, 213, 214, 215, 216, 217, 218, 219, 220, 221, 222, 223, 224, 228, 229, 230, 231, 
    232, 233, 234, 235, 236, 237, 238, 239, 240, 241, 242, 243, 244, 245, 246, 247, 248, 249, 250, 
    251, 252, 253, 254, 255, 256, 2333, 2334
);

-- 2. Actualización explícita de los 22 Bienes Muebles No Sujetos a SPOT (Chips y Hojas)
UPDATE public.fg_producto_facturacion
SET 
    naturaleza_spot = 'BIEN',
    sujeto_detraccion = false,
    detraccion_codigo = NULL,
    detraccion_porcentaje = NULL,
    fecha_modificacion = CURRENT_TIMESTAMP
WHERE id IN (
    25, 69, 73, 74, 86, 87, 88, 97, 101, 103, 131, 132, 133, 160, 161, 162, 225, 226, 227, 2335, 2336, 2337
);

-- 3. Los 22 casos pendientes (7 no estándar + 15 notariales) permanecen intactos en NULL:
-- IDs: 19, 20, 119, 157, 158, 159, 2312, 84, 98, 141, 142, 143, 144, 145, 146, 147, 148, 149, 150, 151, 152, 153

COMMIT;

