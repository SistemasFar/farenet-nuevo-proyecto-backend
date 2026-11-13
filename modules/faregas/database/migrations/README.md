# FAREGAS — Guía de Instalación y Migración de Base de Datos Independiente

Este documento detalla el procedimiento técnico, inventario estructural y clasificación de dependencias para el despliegue del módulo **FAREGAS** en una base de datos PostgreSQL independiente, separándose formalmente de la base de datos compartida `inspeccion` de **FARENET** (`192.168.14.19`).

---

## 1. Archivos Entregables

La carpeta `farenetBackend/modules/faregas/database/migrations/` contiene los scripts oficiales:

| Archivo | Propósito | Características |
|---|---|---|
| `000_faregas_schema_completo.sql` | Instalación DDL completa de estructuras | 70 tablas propias (69 operativas + `fg_usuario_perfil`), 32 secuencias, 188 FKs (176 internas + 12 externas a stubs), 44 UNIQUEs, 118 índices secundarios, 2 funciones PL/pgSQL y 2 triggers de inmutabilidad. |
| `001_faregas_datos_iniciales.sql` | Carga inicial de catálogos y reglas RBAC | 11 perfiles (`fg_perfil`), 51 permisos (`fg_permiso`), 221 asignaciones RBAC (`fg_perfil_permiso`), 7 tipos de certificado (`fg_tipo_certificado`), usuario técnico de sistema deshabilitado y descuento inicial `CORTESIA_FAREGAS`. 100% idempotente (`ON CONFLICT`). Cero datos confidenciales. |
| `README.md` | Guía de arquitectura, dependencias y ejecución | Este documento técnico. |

> [!WARNING]
> **ADVERTENCIA DE SEGURIDAD OPERATIVA:**
> Los scripts `000_faregas_schema_completo.sql` y `001_faregas_datos_iniciales.sql` están diseñados **EXCLUSIVAMENTE** para su ejecución en una nueva base de datos PostgreSQL independiente. **NO EJECUTAR** estos scripts en la base compartida de producción `inspeccion` (`192.168.14.19`).

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

### Categoría A — Tablas Propias de FAREGAS (69 tablas operativas + 1 de desacoplamiento)

Tablas cuya estructura y datos son de dominio exclusivo de FAREGAS:
- **Gestión de Certificados y Emisión:** `fg_certificado`, `fg_certificado_chip`, `fg_certificado_conformidad`, `fg_certificado_duplicado`, `fg_certificado_formato`, `fg_certificado_formato_version`, `fg_certificado_glp`, `fg_certificado_glp_componente`, `fg_certificado_glp_verificacion`, `fg_certificado_gnv`, `fg_certificado_gnv_componente`, `fg_certificado_gnv_verificacion`, `fg_certificado_titular`, `fg_certificado_vehiculo`, `fg_certificado_version`, `fg_correlativo_certificado`, `fg_correlativo_certificado_sede`, `fg_tipo_certificado`.
- **Facturación Electrónica y Pagos:** `fg_facturacion`, `fg_facturacion_cuota`, `fg_facturacion_intento`, `fg_credito`, `fg_debito`, `fg_orden_pago`, `fg_pago`, `fg_serie_comprobante`, `fg_producto_facturacion`, `fg_documento_electronico_operacion`, `fg_documento_anulacion`, `fg_nota_credito_trabajo`.
- **Operaciones Comerciales y Clientes:** `fg_operacion_comercial`, `fg_operacion_detalle`, `fg_operacion_detalle_chip`, `fg_venta`, `fg_venta_detalle`, `fg_cliente`, `fg_servicio`, `fg_tarifa`, `fg_descuento`, `fg_descuentocliente`, `fg_descuentocomprobante`, `fg_descuentodetalle`.
- **Inventario y Hardware (Chips):** `fg_chip`, `fg_chip_movimiento`, `fg_producto_inventariable`, `fg_producto_inventariable_sede`, `fg_producto_sede`, `fg_inventario_cantidad_movimiento`.
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

### Paso 2: Despliegue de Esquema Estructural (DDL)

Ejecutar desde terminal mediante `psql` activando la detención ante cualquier error (`ON_ERROR_STOP=1`):

```bash
psql -h <HOST> -p <PUERTO> -U <USUARIO> -d faregas_db -v ON_ERROR_STOP=1 -f 000_faregas_schema_completo.sql
```

### Paso 3: Carga de Datos Iniciales y Configuración (DML)

Ejecutar el script de catálogos base e idempotente:

```bash
psql -h <HOST> -p <PUERTO> -U <USUARIO> -d faregas_db -v ON_ERROR_STOP=1 -f 001_faregas_datos_iniciales.sql
```

### Paso 4: (Opcional) Carga de Productos de Facturación

Si se requiere poblar el catálogo base de productos de facturación y SKUs de venta:

```bash
node farenetBackend/modules/faregas/database/scripts/import_faregas_productos.js
```

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
- **Total Tablas Base:** 76 (69 operativas `fg_*` + 7 stubs de catálogo compartido).
- **Tablas Propias FAREGAS (`fg_*`):** 69 operativas (+ `fg_usuario_perfil` = 70).
- **Columnas:** 997 columnas.
- **Primary Keys:** 76 PKs.
- **Foreign Keys:** 188 FKs (176 internas + 12 externas hacia catálogos).
- **Restricciones UNIQUE:** 44.
- **Total Índices:** 240 (118 secundarios + 122 índices implícitos de PK y UNIQUE).
- **Secuencias:** 32 secuencias.
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

