# Base de datos FAREGAS

## Instalación nueva

Después de una revisión DBA y únicamente sobre una base nueva, ejecutar
`faregas_instalacion_completa.sql`. El archivo requiere que ya existan los
catálogos heredados de FARENET que aparecen como destinos de claves foráneas;
los consulta o referencia, pero no los modifica.

El instalador crea 69 tablas funcionales `fg_*`, incluyendo notificaciones y
`fg_usuario_perfil`, con sus secuencias, claves, restricciones, índices,
funciones, triggers y catálogos propios mínimos. No incluye el respaldo
histórico `fg_descuentodetalle_backup_20260826_reglas_compartidas`, datos
transaccionales ni credenciales.

El catálogo RBAC incluye los seis perfiles, 50 permisos y 156 asignaciones
vigentes observadas el 2026-11-06 mediante consultas de solo lectura. No
incluye usuarios. Empresa, sedes, servicios, productos, tarifas, talleres,
series y correlativos son configuración específica de cada despliegue y deben
provisionarse y validarse separadamente antes de habilitar la operación.

## Actualización de instalaciones existentes

No ejecutar el instalador completo sobre una instalación existente. Para esas
bases se conservan `migrations/` y `migrations_history/`; cada incremental debe
ser revisado y aplicado de forma controlada según el estado real de la base.
No existe un ejecutor automático de migraciones en este directorio.

## Historial

`migrations_history` conserva 97 migraciones incrementales anteriores para
auditoría y pruebas. Varias pruebas focalizadas leen directamente esos
archivos; no deben eliminarse, renombrarse ni ejecutarse después de una
instalación nueva realizada con el consolidado.

La tabla histórica
`fg_descuentodetalle_backup_20260826_reglas_compartidas` no forma parte del
nuevo esquema porque era un respaldo puntual y no tiene consumidores en el
runtime.
