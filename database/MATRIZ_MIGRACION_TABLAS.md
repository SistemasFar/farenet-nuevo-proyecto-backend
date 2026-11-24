# MATRIZ OFICIAL DE CLASIFICACIÓN DE TABLAS FAREGAS PARA AMAZON RDS

Esta matriz define el tratamiento exacto de **cada una de las 75 tablas con prefijo `fg_*`** detectadas en la base de datos de origen (`192.168.14.19/inspeccion`), garantizando la preservación total de la configuración comercial y la **exclusión absoluta de las operaciones de prueba**.

---

## 1. Tablas a MIGRAR COMPLETAMENTE (Maestros y Configuración Base)

Estas tablas contienen los catálogos comerciales, sedes, perfiles de seguridad, usuarios y precios personalizados:

| # | Tabla | Registros Origen | Estrategia | Justificación Técnica |
|---|---|:---:|---|---|
| 1 | `fg_perfil` | 4 activos (11 catálogo) | MIGRAR COMPLETA | Roles y perfiles RBAC (`OPERADOR`, `SUPERVISOR`, `CONTADOR`, `SISTEMAS`). |
| 2 | `fg_permiso` | 50 activos (51 catálogo) | MIGRAR COMPLETA | Catálogo de permisos del sistema para control de accesos. |
| 3 | `fg_perfil_permiso` | 83 activos (229 catálogo) | MIGRAR COMPLETA | Mapeo rol-permiso para pantallas, botones y operaciones. |
| 4 | `fg_empresa` | 14 | MIGRAR COMPLETA | Empresas emisoras, RUCs, cuentas corrientes de Banco de la Nación. |
| 5 | `fg_empresa_facturador` | 28 | MIGRAR COMPLETA | Credenciales y endpoints de facturación electrónica NubeFact. |
| 6 | `fg_planta` | 31 (14 activas) | MIGRAR COMPLETA | Sedes de inspección y plantas activas/históricas vinculadas al POS. |
| 7 | `fg_perfil_planta` | 99 | MIGRAR COMPLETA | Permisos de perfiles autorizados por cada sede física. |
| 8 | `fg_usuario` | 33 (28 activos) | MIGRAR COMPLETA | Cuentas reales de operadores y cajeros con sus contraseñas encriptadas. |
| 9 | `fg_usuario_credencial` | 33 | MIGRAR COMPLETA | Metadatos y políticas de contraseñas de las cuentas de usuario. |
| 10 | `fg_usuario_perfil` | 32 | MIGRAR COMPLETA | Datos personales, DNI, nombres y correos de los operadores. |
| 11 | `fg_usuario_planta` | 425 | MIGRAR COMPLETA | Asignaciones de los operadores a sus sedes de trabajo autorizadas. |
| 12 | `fg_credencial_custodia` | 2 | MIGRAR COMPLETA | Custodia de credenciales administrativas cifradas del sistema. |
| 13 | `fg_categoria_servicio` | 4 | MIGRAR COMPLETA | Categorías base: `GLP`, `GNV`, `CONFORMIDAD` y `COMPLEMENTARIOS`. |
| 14 | `fg_servicio` | 96 | MIGRAR COMPLETA | Servicios operativos, flujos, flags de certificado y detracciones. |
| 15 | `fg_producto_facturacion` | 275 | MIGRAR COMPLETA | **CRÍTICO:** Conserva precios editados (ej. SKU 0211 a S/ 80, SKU 0439 a S/ 70) y nuevos SKU (`GNV-ANUAL-201`, `GNV-INICIAL-201`). |
| 16 | `fg_producto_inventariable` | 3 | MIGRAR COMPLETA | Ítems físicos: `CHIP`, `HOJA_GLP` y `HOJA_CONFORMIDAD`. |
| 17 | `fg_producto_inventariable_sede` | 20 | MIGRAR COMPLETA | Habilitación de venta y precios inventariables por cada sede. |
| 18 | `fg_tarifa` | 175 | MIGRAR COMPLETA | Tarifario comercial cruzado por sede, servicio y producto. |
| 19 | `fg_descuento` | 1 | MIGRAR COMPLETA | Regla comercial activa: `CORTESIA_FAREGAS` (100%). |
| 20 | `fg_tipo_certificado` | 5 | MIGRAR COMPLETA | Códigos oficiales MTC: `39` (Conformidad), `41` (GLP), `22` (GNV), `T1`, `T2`. |
| 21 | `fg_certificado_formato` | 14 | MIGRAR COMPLETA | Formatos oficiales de certificados (GNV Inicial/Anual, GLP Inicial/Anual, Conformidad, Taller). |
| 22 | `fg_certificado_formato_version` | 20 | MIGRAR COMPLETA | Versiones de plantillas HTML y layouts de impresión PDF. |
| 23 | `fg_taller_autorizado` | 5 | MIGRAR COMPLETA | Talleres autorizados GNV / GLP vinculados a certificados. |
| 24 | `fg_ejecutivo` | 2 | MIGRAR COMPLETA | Ejecutivos comerciales asignados a descuentos. |

---

## 2. Tablas con MIGRACIÓN DE ESTADO DE CORTE (Preservan Correlatividad y Stock)

Estas tablas requieren migrar su estado final verificado para no reiniciar numeraciones ni duplicar números de serie, desvinculándolas de las transacciones de prueba:

| # | Tabla | Registros Origen | Estrategia de Corte | Justificación Técnica |
|---|---|:---:|---|---|
| 25 | `fg_serie_comprobante` | 288 (51 activas) | MIGRAR ESTADO DE CORTE | Conserva el `ultimo_numero` exacto emitido para evitar colisiones y rechazos SUNAT. No se reinicia ningún correlativo. |
| 26 | `fg_correlativo_certificado` | 66 | MIGRAR ESTADO DE CORTE | Conserva el `nro_actual` de cada tipo y modalidad por planta. |
| 27 | `fg_correlativo_certificado_sede` | 74 | MIGRAR ESTADO DE CORTE | **Preserva los 64 rangos agotados** (disponibles=0) y los **10 rangos activos** con su saldo exacto (41 a 50 hojas disponibles). |
| 28 | `fg_chip` | 38 | MIGRAR ESTADO DE CORTE | Conserva los **3 chips físicamente disponibles** en Sede 160 (`CHIP111`, `CHIP77`, `CHIP44`) y los **35 chips consumidos** con estado `'VENDIDO'` y `operacion_reserva_id=NULL` para que sus series queden bloqueadas contra reuso. |
| 29 | `fg_chip_movimiento` | 77 | MIGRAR ESTADO DE CORTE | Preserva la trazabilidad de recepción y asignación física de chips, con claves `operacion_comercial_id` y `certificado_id` en `NULL`. |
| 30 | `fg_inventario_cantidad_movimiento` | 5 (2 ingresos) | MIGRAR ESTADO DE CORTE | Migra únicamente los movimientos de tipo `'INGRESO'` de papel en plantas, omitiendo las líneas de venta de prueba. |

---

## 3. Tablas EXCLUIDAS TOTALMENTE (Operaciones Comerciales y Certificados de Prueba)

Estas tablas corresponden a pruebas locales y demostraciones; **inician en CERO (0) registros** en Amazon RDS:

| # | Tabla | Registros Origen | Estado en Destino | Motivo de Exclusión |
|---|---|:---:|:---:|---|
| 31 | `fg_operacion_comercial` | 115 | 0 | Ventas de prueba. Al excluirse, el Dashboard y POS inician limpios. |
| 32 | `fg_operacion_detalle` | 136 | 0 | Ítems y líneas de venta de prueba. |
| 33 | `fg_operacion_detalle_chip` | 35 | 0 | Asignación transaccional de chips en ventas de prueba. |
| 34 | `fg_orden_pago` | 115 | 0 | Órdenes de cobro generadas durante pruebas. |
| 35 | `fg_pago` | 92 | 0 | Pagos en efectivo, POS o transferencias de prueba. |
| 36 | `fg_credito` | 5 | 0 | Cuentas por cobrar de prueba. |
| 37 | `fg_debito` | 0 | 0 | Vacía en origen. |
| 38 | `fg_facturacion` | 114 | 0 | Comprobantes fiscales emitidos en entorno DEMO. |
| 39 | `fg_facturacion_cuota` | 26 | 0 | Cuotas de facturas de prueba. |
| 40 | `fg_facturacion_intento` | 4,383 | 0 | Logs técnicos y reintentos NubeFact DEMO. |
| 41 | `fg_facturacion_contingencia` | 2 | 0 | Contingencias de prueba. |
| 42 | `fg_nota_credito_trabajo` | 5 | 0 | Borradores de notas de crédito de prueba. |
| 43 | `fg_documento_electronico_operacion` | 8 | 0 | Enlaces transaccionales de prueba. |
| 44 | `fg_documento_anulacion` | 2 | 0 | Bajas y anulaciones de prueba. |
| 45 | `fg_descuentocomprobante` | 6 | 0 | Descuentos aplicados a ventas de prueba. |
| 46 | `fg_descuentocliente` | 0 | 0 | Vacía en origen. |
| 47 | `fg_descuentodetalle` | 0 | 0 | Vacía en origen. |
| 48 | `fg_certificado` | 76 | 0 | Certificados vehiculares emitidos en pruebas locales. |
| 49 | `fg_certificado_glp` | 66 | 0 | Datos técnicos GLP de prueba. |
| 50 | `fg_certificado_glp_componente` | 132 | 0 | Componentes (tanque, reductor) de prueba. |
| 51 | `fg_certificado_glp_verificacion` | 462 | 0 | Checklists de verificación GLP de prueba. |
| 52 | `fg_certificado_gnv` | 5 | 0 | Datos técnicos GNV de prueba. |
| 53 | `fg_certificado_gnv_componente` | 0 | 0 | Vacía en origen. |
| 54 | `fg_certificado_gnv_verificacion` | 40 | 0 | Checklists de verificación GNV de prueba. |
| 55 | `fg_certificado_conformidad` | 3 | 0 | Certificados de modificación/montaje de prueba. |
| 56 | `fg_certificado_duplicado` | 31 | 0 | Solicitudes de duplicado de prueba. |
| 57 | `fg_certificado_titular` | 75 | 0 | Titulares registrados en pruebas. |
| 58 | `fg_certificado_vehiculo` | 75 | 0 | Snapshots de vehículos en certificados de prueba. |
| 59 | `fg_certificado_chip` | 0 | 0 | Vacía en origen. |
| 60 | `fg_certificado_version` | 0 | 0 | Vacía en origen. |
| 61 | `fg_cliente` | 5 | 0 | Clientes de prueba creados en laboratorio. |
| 62 | `fg_vehiculo` | 1 | 0 | Vehículo de prueba creado en laboratorio. |
| 63 | `fg_venta` | 0 | 0 | Vacía en origen (legacy). |
| 64 | `fg_venta_detalle` | 0 | 0 | Vacía en origen (legacy). |
| 65 | `fg_solicitud_operacion` | 7 | 0 | Solicitudes de rectificación/anulación de prueba. |
| 66 | `fg_solicitud_operacion_evento` | 851 | 0 | Eventos de auditoría de solicitudes de prueba. |
| 67 | `fg_usuario_sesion` | 156 | 0 | Tokens de sesión HTTP anteriores. |
| 68 | `fg_auditoria_acceso` | 3,015 | 0 | Logs de login y accesos locales. |
| 69 | `fg_auditoria_config` | 2,525 | 0 | Logs de cambios administrativos locales. |
| 70 | `fg_notificacion` | 20 | 0 | Notificaciones operativas de prueba. |
| 71 | `fg_notificacion_destinatario` | 218 | 0 | Destinatarios de notificaciones de prueba. |
| 72 | `fg_usuario_mfa` | 0 | 0 | Vacía en origen. |
| 73 | `fg_producto_sede` | 0 | 0 | Vacía en origen. |

---

## 4. Tablas de Backup Manual en Origen (DESCARTE DEFINITIVO)

Tablas auxiliares temporales creadas manualmente en el servidor `192.168.14.19` durante tareas de desarrollo; **no forman parte de la arquitectura del sistema**:

| # | Tabla | Registros Origen | Estado | Motivo |
|---|---|:---:|:---:|---|
| 74 | `fg_descuentodetalle_backup_20260826_reglas_compartidas` | 31 | NO EXISTE EN SQL / DESCARTAR | Backup manual puntual de agosto 2026. |
| 75 | `fg_facturacion_backup_856_1258` | 1 | NO EXISTE EN SQL / DESCARTAR | Backup manual puntual de pruebas de facturación. |

---

## 5. Tabla en SQL Pendiente de Inicialización

| # | Tabla | Definición DDL | Registros Destino | Motivo |
|---|---|:---:|:---:|---|
| - | `fg_chip_codigo_reserva` | Creada en `MIGRACION_SCRIPT.sql` | 0 | Tabla transaccional para reservas temporales de chips en caja POS. Inicia vacía. |

---

## 6. Resumen Cuantitativo de la Clasificación

* **Total tablas en Origen:** 75 tablas.
* **Tablas de configuración a MIGRAR COMPLETAMENTE:** 24 tablas.
* **Tablas a MIGRAR CON ESTADO DE CORTE (Rangos, Series, Chips, Papel):** 6 tablas.
* **Tablas transaccionales EXCLUIDAS (Pruebas comerciales):** 43 tablas.
* **Tablas de backup manual DESCARTADAS:** 2 tablas.
* **Total tablas operativas resultantes en Amazon RDS:** **74 tablas** (coincidencia exacta del 100% con `MIGRACION_SCRIPT.sql`).

