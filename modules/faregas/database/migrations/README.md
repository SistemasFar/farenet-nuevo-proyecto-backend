# FAREGAS — Guía de Instalación y Migración de Base de Datos Independiente

Este documento detalla el procedimiento técnico, inventario estructural y clasificación de dependencias para el despliegue del módulo **FAREGAS** en una base de datos PostgreSQL independiente, separándose formalmente de la base de datos compartida `inspeccion` de **FARENET** (`192.168.14.19`).

---

## 1. Archivos Entregables

El archivo [faregas_consolidado.sql](../faregas_consolidado.sql) contiene los bloques SQL. Los nombres de la tabla corresponden a los encabezados de esos bloques.

| Archivo | Propósito | Características |
|---|---|---|
| `000_faregas_schema_completo.sql` | Instalación DDL completa de estructuras | Incluye soporte SPOT en `fg_facturacion`, `fg_credito`, `fg_servicio` y `fg_producto_facturacion`, con índices de facturación. La clasificación comienza en `NULL`; no asigna código ni tasa por defecto. |
| `001_faregas_datos_iniciales.sql` | Carga inicial de catálogos y reglas RBAC | 11 perfiles (`fg_perfil`), 51 permisos (`fg_permiso`), 221 asignaciones RBAC (`fg_perfil_permiso`), 7 tipos de certificado (`fg_tipo_certificado`), usuario técnico de sistema deshabilitado y descuento inicial `CORTESIA_FAREGAS`. 100% idempotente (`ON CONFLICT`). Cero datos confidenciales. |
| `002_ampliacion_auditoria_integral.sql` | Ampliación de auditoría FAREGAS | Extiende auditoría e índices propios `fg_*`. |
| `003_migracion_fg_usuario_perfil_independiente.sql` | Perfil propio de usuario FAREGAS | Crea `fg_usuario_perfil` y realiza backfill inicial condicional. No es dependencia de SPOT; 004 no toca usuarios ni perfiles. |
| `004_implementacion_detracciones_spot.sql` | Migración incremental SPOT para instalaciones existentes | Añade columnas nullable e índices en tablas `fg_*`; es transaccional e idempotente. No contiene `UPDATE`, `DELETE`, defaults de clasificación ni cambios a tablas FARENET. |
| `005_optimizacion_eliminacion_usuarios_perfiles.sql` | Optimización de eliminación y reasignación de perfiles/usuarios | Configura `ON DELETE CASCADE` en `fg_perfil_permiso` y `fg_perfil_planta`; desvincula FK en `fg_auditoria_config` para snapshots históricos inmutables sin bloqueos. |
| `006_codigos_chip_autogenerables.sql` | Códigos disponibles para tipos de chip compatibles | Agrega opt-in `codigo_autogenerable` (FALSE por defecto) y reservas temporales globalmente únicas. No habilita productos existentes ni modifica chips o tablas FARENET. |
| `007_permisos_dashboard_perfiles_operativos.sql` | Permisos Dashboard para perfiles operativos | Asigna `DASHBOARD_GLOBAL`, `DASHBOARD_EXPORTAR` y `MENU_DASHBOARD` a CONTADOR y OPERADOR. |
| `008_habilitar_naturaleza_fiscal_spot.sql` | Habilitación de naturaleza fiscal SPOT en productos | Agrega `naturaleza_spot varchar(20)` y check constraint (`BIEN`, `SERVICIO`) a `fg_producto_facturacion`. Permite guardar clasificación fiscal SPOT para productos comerciales (ej. certificados con código 037 al 12%). |
| `009_actualizacion_masiva_spot_productos.sql` | Clasificación fiscal SPOT definitiva de productos | Configura por IDs explícitos 231 Servicios (Código 037, 12%) y 22 Bienes (No sujetos), manteniendo 22 en revisión. |
| `README.md` | Guía de arquitectura, dependencias y ejecución | Este documento técnico. |

> [!WARNING]
> **ADVERTENCIA DE SEGURIDAD OPERATIVA:**
> Los scripts `000_faregas_schema_completo.sql` y `001_faregas_datos_iniciales.sql` están diseñados **EXCLUSIVAMENTE** para su ejecución en una nueva base de datos PostgreSQL independiente. **NO EJECUTAR** estos scripts en la base compartida de producción `inspeccion` (`192.168.14.19`).

> La migración `004_implementacion_detracciones_spot.sql` es únicamente para una instalación existente que requiera habilitar SPOT y cuyas tablas FAREGAS objetivo ya existan. No ejecute `000` sobre una base existente. Antes de ejecutar 004, confirme base/servidor, respalde la base y verifique las tablas/columnas. El script solo altera `fg_facturacion`, `fg_credito`, `fg_servicio` y `fg_producto_facturacion`; no clasifica registros existentes.

---

## 2. Prerrequisitos de Entorno

- **Motor de Base de Datos:** PostgreSQL 13 o superior (probado y validado en PostgreSQL 13.18 y 13.23).
- **Codificación Requerida:** `UTF-8`.
- **Extensiones Requeridas:**
  - `btree_gist`: Utilizada para restricciones de exclusión y soporte de índices avanzados. Se instala automáticamente mediante `CREATE EXTENSION IF NOT EXISTS btree_gist;` (requiere privilegios de superusuario o rol con autorización para extensiones).
- **Privilegios de Usuario:** Usuario con permisos `CREATEDB` y propiedad del esquema `public`.

---

## 3. Inventario y Clasificación Exhaustiva de Dependencias

Para garantizar una migración sin fallas de integridad referencial ni acoplamientos ocultos, todas las tablas y objetos relacionados se clasifican en cuatro categorías normativas:

### Categoría A — Tablas Propias de FAREGAS (70 tablas `fg_*`)

Tablas cuya estructura y datos son de dominio exclusivo de FAREGAS:
- **Gestión de Certificados y Emisión:** `fg_certificado`, `fg_certificado_chip`, `fg_certificado_conformidad`, `fg_certificado_duplicado`, `fg_certificado_formato`, `fg_certificado_formato_version`, `fg_certificado_glp`, `fg_certificado_glp_componente`, `fg_certificado_glp_verificacion`, `fg_certificado_gnv`, `fg_certificado_gnv_componente`, `fg_certificado_gnv_verificacion`, `fg_certificado_titular`, `fg_certificado_vehiculo`, `fg_certificado_version`, `fg_correlativo_certificado`, `fg_correlativo_certificado_sede`, `fg_tipo_certificado`.
- **Facturación Electrónica y Pagos:** `fg_facturacion`, `fg_facturacion_cuota`, `fg_facturacion_intento`, `fg_credito`, `fg_debito`, `fg_orden_pago`, `fg_pago`, `fg_serie_comprobante`, `fg_producto_facturacion`, `fg_documento_electronico_operacion`, `fg_documento_anulacion`, `fg_nota_credito_trabajo`.
- **Operaciones Comerciales y Clientes:** `fg_operacion_comercial`, `fg_operacion_detalle`, `fg_operacion_detalle_chip`, `fg_venta`, `fg_venta_detalle`, `fg_cliente`, `fg_servicio`, `fg_tarifa`, `fg_descuento`, `fg_descuentocliente`, `fg_descuentocomprobante`, `fg_descuentodetalle`.
- **Inventario y Hardware (Chips):** `fg_chip`, `fg_chip_movimiento`, `fg_chip_codigo_reserva`, `fg_producto_inventariable`, `fg_producto_inventariable_sede`, `fg_producto_sede`, `fg_inventario_cantidad_movimiento`.
- **Solicitudes Administrativas y Notificaciones:** `fg_solicitud_operacion`, `fg_solicitud_operacion_evento`, `fg_notificacion`, `fg_notificacion_destinatario`.
- **Seguridad, Usuarios y RBAC:** `fg_usuario`, `fg_usuario_perfil` *(tabla propia para desacoplar datos personales de `persona` de FARENET)*, `fg_usuario_planta`, `fg_usuario_sesion`, `fg_perfil`, `fg_permiso`, `fg_perfil_permiso`, `fg_perfil_planta`, `fg_auditoria_acceso`, `fg_auditoria_config`.
- **Estructura Organizacional y Técnicos:** `fg_empresa`, `fg_empresa_facturador`, `fg_planta`, `fg_taller_autorizado`, `fg_ejecutivo`, `fg_categoria_servicio`, `fg_vehiculo`.

> [!NOTE]
> **Exclusión de Tablas Transitorias:**
> La tabla `fg_descuentodetalle_backup_20260826_reglas_compartidas` presente en la base de producción compartida fue excluida deliberadamente de este esquema. Dicha tabla fue creada como un respaldo puntual durante una migración histórica en agosto de 2026 y no tiene consumidores ni referencias en el código fuente.

### Categoría B — Tablas Compartidas de FARENET consumidas en Solo Lectura

El backend de FAREGAS consulta datos maestros de FARENET a través de una única frontera aislada:
- **Adaptador de Lectura:** `farenetBackend/modules/faregas/integrations/farenet-read.adapter.js`.
- **Tablas Maestras Consultadas:**
  - `persona`: Búsqueda de clientes y propietarios por documento de identidad.
  - `vehiculo`: Consulta de datos técnicos vehiculares por placa.
  - `tarjetapropiedad`: Validación registral vehicular.
- **Catálogos Vehiculares Consultados:**
  - `categoria`, `vehiculoclase`, `marca`, `modelo`, `combustible`, `color`, `carroceria`.
- **Estrategia de Desacoplamiento para la Base Independiente:**
  1. *Fase 1 (Transición):* Consumo vía Foreign Data Wrapper (`postgres_fdw`) enlazado a la base de FARENET en modo solo lectura.
  2. *Fase 2 (Independencia Completa):* Sincronización asíncrona mediante réplica lógica de catálogos o consumo a través de API REST interna de FARENET.

### Categoría C — Tablas Catálogo de FARENET con Claves Foráneas Salientes (12 FKs)

Existen exactamente 12 claves foráneas en tablas de FAREGAS que apuntan a 7 tablas de catálogo en FARENET:

| Tabla Origen (FAREGAS) | Columna Origen | Tabla Destino (FARENET) | Columna Destino | Nombre de Constraint | Comportamiento |
|---|---|---|---|---|---|
| `fg_credito` | `moneda_key` | `moneda` | `key` | `fk_fg_credito_moneda` | ON UPDATE CASCADE ON DELETE RESTRICT |
| `fg_debito` | `moneda_key` | `moneda` | `key` | `fk_fg_debito_moneda` | ON UPDATE CASCADE ON DELETE RESTRICT |
| `fg_facturacion` | `moneda_key` | `moneda` | `key` | `fk_fg_facturacion_moneda` | ON UPDATE CASCADE |
| `fg_operacion_comercial` | `moneda_key` | `moneda` | `key` | `fk_fg_operacion_moneda` | ON UPDATE CASCADE ON DELETE RESTRICT |
| `fg_orden_pago` | `formapago_key` | `formapago` | `key` | `fk_fg_orden_pago_formapago` | ON UPDATE CASCADE ON DELETE RESTRICT |
| `fg_orden_pago` | `moneda_key` | `moneda` | `key` | `fk_fg_orden_pago_moneda` | ON UPDATE CASCADE ON DELETE RESTRICT |
| `fg_pago` | `cuentacorriente_key` | `cuentacorriente` | `key` | `fk_fg_pago_cuenta` | ON UPDATE CASCADE ON DELETE RESTRICT |
| `fg_pago` | `entidadfinanciera_key` | `entidadfinanciera` | `key` | `fk_fg_pago_entidad` | ON UPDATE CASCADE ON DELETE RESTRICT |
| `fg_pago` | `moneda_key` | `moneda` | `key` | `fk_fg_pago_moneda` | ON UPDATE CASCADE ON DELETE RESTRICT |
| `fg_pago` | `tarjeta_key` | `tarjeta` | `key` | `fk_fg_pago_tarjeta` | ON UPDATE CASCADE ON DELETE RESTRICT |
| `fg_pago` | `tipocontado_key` | `tipocontado` | `key` | `fk_fg_pago_tipo_contado` | ON UPDATE CASCADE ON DELETE RESTRICT |
| `fg_usuario` | `persona_nrodocumentoidentidad` | `persona` | `nrodocumentoidentidad` | `fk_fg_usuario_persona` | ON UPDATE CASCADE ON DELETE SET NULL |

**Manejo en el instalador:** El archivo `000_faregas_schema_completo.sql` incluye las definiciones mínimas `IF NOT EXISTS` para estas 7 tablas de soporte (`moneda`, `formapago`, `cuentacorriente`, `entidadfinanciera`, `tarjeta`, `tipocontado`, `persona`), permitiendo que el script se instale y valide íntegramente de manera autónoma sin errores de dependencias rotas. En producción, dichas tablas serán alimentadas por replicación de catálogos.

### Categoría D — Tablas Exclusivas de FARENET

Tablas operativas de inspección vehicular técnica: `inspeccion`, `linea`, `resultado_maquina`, `resultado_maquina_defecto`, `tramite`, `pista`, `defectos`, etc.
- **Relación con FAREGAS:** **CERO dependencia.**
- **Claves Foráneas Entrantes:** No existe **ninguna** clave foránea en toda la base de datos de FARENET que apunte hacia tablas `fg_*`. La separación física no impactará la integridad estructural de FARENET.

---

## 4. Procedimiento de Ejecución

Para desplegar una nueva base de datos independiente de FAREGAS, ejecutar en orden estricto:

### Paso 1: Creación de la Base de Datos

Conectarse a la instancia de PostgreSQL con un usuario administrativo y ejecutar:

```sql
CREATE DATABASE faregas_db
    WITH ENCODING = 'UTF8'
    LC_COLLATE = 'Spanish_Peru.1252' -- O 'C' / 'en_US.UTF-8' según el SO
    LC_CTYPE = 'Spanish_Peru.1252'
    TEMPLATE = template0;
```

### Paso 2: Instalación del esquema y los catálogos iniciales

Desde la carpeta `database`, ejecute el SQL completo con detención ante errores:

```bash
psql -h <HOST> -p <PUERTO> -U <USUARIO> -d faregas_db -v ON_ERROR_STOP=1 -f faregas_consolidado.sql
```

### Paso 3: (Opcional) Carga de Productos de Facturación

Si se requiere poblar el catálogo base de productos de facturación y SKUs de venta:

```bash
node farenetBackend/modules/faregas/database/scripts/import_faregas_productos.js
```

### Migraciones incrementales para una instalación existente

El orden histórico de migraciones FAREGAS es `002` → `003` → `004` después de la instalación base y los datos iniciales. Para SPOT, la única migración requerida es `004_implementacion_detracciones_spot.sql`; `000` y otras migraciones no deben repetirse para habilitar esta función. La 004 no depende de `fg_usuario_perfil` de la 003 y no modifica esa tabla.

Antes de la ejecución, compruebe que el respaldo sea restaurable y que existan `public.fg_facturacion`, `public.fg_credito`, `public.fg_servicio` y `public.fg_producto_facturacion`. La migración requiere PostgreSQL 13 o superior y se ejecuta en una transacción (`BEGIN`/`COMMIT`). Sus columnas SPOT se agregan sin `DEFAULT`, por lo que los valores existentes quedan intactos y la clasificación de servicios/productos permanece `NULL` hasta su configuración explícita.

Extraiga la sección `004_implementacion_detracciones_spot.sql` del consolidado y ejecútela dentro de una transacción, con detención ante errores.

Verifique la estructura, ausencia de defaults y pendientes de clasificación:

```sql
SELECT table_name, column_name, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('fg_facturacion', 'fg_credito', 'fg_servicio', 'fg_producto_facturacion')
  AND (column_name = 'sujeto_detraccion' OR column_name LIKE 'detraccion_%')
ORDER BY table_name, ordinal_position;

SELECT indexname
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname IN ('idx_fg_facturacion_detraccion', 'idx_fg_facturacion_detraccion_constancia')
ORDER BY indexname;

SELECT count(*) AS servicios_pendientes_de_clasificar
FROM public.fg_servicio
WHERE sujeto_detraccion IS NULL;
```

La instalación nueva (`000`) y la migración incremental (`004`) declaran los mismos campos e índices SPOT. La repetición de `ADD COLUMN/INDEX IF NOT EXISTS` dentro de 004 sirve para despliegues existentes y no duplica objetos. No se agregan restricciones SPOT: un servicio sin clasificación debe permanecer pendiente y el backend impide emitir una factura sujeta hasta completar su configuración.

### Migración 006 — códigos de chips asignables

`006_codigos_chip_autogenerables.sql` es una migración incremental FAREGAS y debe ejecutarse después de las migraciones ya aplicables a la instalación (incluida 005 cuando corresponda). Requiere `fg_producto_inventariable`, `fg_chip` y `fg_planta`. No ejecuta backfills: los productos existentes quedan con `codigo_autogenerable = FALSE`; solo personal autorizado puede habilitar la opción para un producto `CHIP_SERIALIZADO` luego de confirmar que el proveedor permite asignar códigos internos.

La tabla `fg_chip_codigo_reserva` guarda propuestas por 15 minutos y reserva cada código de forma global. El índice único de `numero_chip` evita que dos propuestas activas lo compartan. Al confirmar, el backend serializa las reservas e ingresos mediante un advisory lock transaccional, revalida el producto, sede, vencimiento y conjunto exacto propuesto, y conserva la restricción única existente de `fg_chip.numero_chip` como última defensa. Escaneo, importación y rango exacto siguen tratando sus códigos como identificadores físicos: un duplicado se informa y bloquea, sin reemplazo.

Después de verificar la base existente y el respaldo, extraiga la sección `006_codigos_chip_autogenerables.sql` del consolidado y ejecútela dentro de una transacción.

Verificación posterior:

```sql
SELECT column_name, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'fg_producto_inventariable'
  AND column_name = 'codigo_autogenerable';

SELECT indexname
FROM pg_indexes
WHERE schemaname = 'public' AND tablename = 'fg_chip_codigo_reserva'
ORDER BY indexname;

SELECT count(*) AS productos_opt_in
FROM public.fg_producto_inventariable
WHERE codigo_autogenerable = TRUE;
```

Inmediatamente después de aplicar 006, `productos_opt_in` debe ser `0`; habilite cada producto manualmente solo tras confirmar compatibilidad con su proveedor. Esta migración no debe aplicarse a tablas de FARENET ni ejecutarse en `inspeccion` sin autorización expresa.

---

## 5. Procedimiento de Auditoría y Verificación Post-Instalación

Ejecutar las siguientes consultas en `faregas_db` para verificar que la instalación coincide exactamente con los valores auditados:

```sql
-- 1. Verificación de conteo de tablas y objetos
SELECT 
    (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE') AS total_tablas_base,
    (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE 'fg_%') AS tablas_fg,
    (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public') AS total_columnas,
    (SELECT count(*) FROM information_schema.table_constraints WHERE table_schema = 'public' AND constraint_type = 'PRIMARY KEY') AS total_pks,
    (SELECT count(*) FROM information_schema.table_constraints WHERE table_schema = 'public' AND constraint_type = 'FOREIGN KEY') AS total_fks,
    (SELECT count(*) FROM information_schema.table_constraints WHERE table_schema = 'public' AND constraint_type = 'UNIQUE') AS total_uniques,
    (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public') AS total_indices,
    (SELECT count(*) FROM information_schema.sequences WHERE sequence_schema = 'public') AS total_secuencias,
    (SELECT count(*) FROM information_schema.triggers WHERE trigger_schema = 'public') AS total_triggers,
    (SELECT count(*) FROM information_schema.routines WHERE routine_schema = 'public' AND routine_name LIKE 'fg_%') AS funciones_fg;

-- 2. Verificación de datos de catálogo iniciales
SELECT
    (SELECT count(*) FROM fg_perfil) AS perfiles_cargados,
    (SELECT count(*) FROM fg_permiso) AS permisos_cargados,
    (SELECT count(*) FROM fg_perfil_permiso) AS asignaciones_rbac,
    (SELECT count(*) FROM fg_tipo_certificado) AS tipos_certificados,
    (SELECT count(*) FROM fg_descuento) AS descuentos_iniciales;

-- 3. Verificación de inmutabilidad operativa de triggers
SELECT trigger_name, event_manipulation, event_object_table 
FROM information_schema.triggers 
WHERE trigger_schema = 'public'
ORDER BY event_object_table, trigger_name;
```

### Métricas de Referencia Esperadas:
- **Total Tablas Base:** 77 (70 tablas FAREGAS `fg_*` + 7 stubs de catálogo compartido).
- **Tablas Propias FAREGAS (`fg_*`):** 70, incluida `fg_chip_codigo_reserva`.
- **Columnas:** 1,006 columnas.
- **Primary Keys:** 77 PKs.
- **Foreign Keys:** 190 FKs (178 internas + 12 externas hacia catálogos).
- **Restricciones UNIQUE:** 45.
- **Total Índices:** 244 (120 secundarios + 124 índices implícitos de PK y UNIQUE).
- **Secuencias:** 33 secuencias.
- **Triggers:** 4 eventos cubiertos (2 triggers: `fg_inventario_cantidad_movimiento_inmutable` y `trg_fg_solicitud_evento_inmutable`).
- **Funciones PL/pgSQL:** 2 funciones de inmutabilidad.
- **Catálogo RBAC:** 11 perfiles, 51 permisos, 221 asignaciones, 7 tipos de certificado y 1 descuento (`CORTESIA_FAREGAS`).

---

## 6. Plan de Contingencia y Reversión (Rollback)

Dado que la instalación se realiza en una base de datos nueva e independiente, cualquier inconveniente durante la ejecución se aísla por completo sin riesgo para el sistema en producción:

1. **Reversión Inmediata de la Base de Datos de Prueba:**
   ```sql
   DROP DATABASE IF EXISTS faregas_db;
   ```
2. **Reversión de Conexión del Backend:**
   En el archivo de configuración `.env` del backend de FAREGAS, conservar la variable `DB_DATABASE=inspeccion` y host `192.168.14.19` hasta que la base independiente haya completado satisfactoriamente todas las pruebas funcionales y la migración de datos históricos.

---

## 7. Permisos de Dashboard para Perfiles Operativos

La migración `007_permisos_dashboard_perfiles_operativos.sql` asigna al perfil `CONTADOR` los permisos `DASHBOARD_GLOBAL` y `DASHBOARD_EXPORTAR`, y al perfil `OPERADOR` los permisos `MENU_DASHBOARD`, `DASHBOARD_GLOBAL` y `DASHBOARD_EXPORTAR`. Es idempotente y falla si alguno de los perfiles no está visible o si falta un permiso activo del catálogo.

No modifica usuarios, contraseñas ni asignaciones de plantas. El Dashboard global y los reportes siguen filtrando cada consulta por las plantas autorizadas al usuario; no se concede `FAREGAS_ACCESO_GLOBAL_SEDES`.

Para verificar la asignación:

```sql
SELECT perfil_clave, permiso_clave
FROM public.fg_perfil_permiso
WHERE perfil_clave IN ('CONTADOR', 'OPERADOR', 'SISTEMAS')
  AND permiso_clave IN ('MENU_DASHBOARD', 'DASHBOARD_SEDE', 'DASHBOARD_GLOBAL', 'DASHBOARD_EXPORTAR')
ORDER BY perfil_clave, permiso_clave;
```

El perfil `SISTEMAS` conserva sus asignaciones actuales. El permiso `DASHBOARD_SEDE` no es necesario para el alcance local: `MENU_DASHBOARD` habilita el módulo, mientras que `DASHBOARD_GLOBAL` habilita la vista global y `DASHBOARD_EXPORTAR` protege los reportes y descargas.

