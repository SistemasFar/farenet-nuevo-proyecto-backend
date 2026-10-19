# Base de datos FAREGAS

## Instalación estructural

Ejecutar `migrations/0001_faregas_schema.sql` sobre una base Farenet que ya
contenga los catálogos legacy requeridos: `moneda`, `formapago`,
`cuentacorriente`, `entidadfinanciera`, `tarjeta`, `tipocontado` y `persona`.

El archivo consolidado crea 61 tablas funcionales FAREGAS con sus secuencias,
claves, restricciones, índices, comentarios, función y trigger. No incluye
datos transaccionales ni configuraciones de empresas, sedes o credenciales.

## Historial

`migrations_history` conserva las 81 migraciones incrementales anteriores para
auditoría y pruebas. No deben ejecutarse después del esquema consolidado.

La tabla histórica
`fg_descuentodetalle_backup_20260826_reglas_compartidas` no forma parte del
nuevo esquema porque era un respaldo puntual y no tiene consumidores en el
runtime.
