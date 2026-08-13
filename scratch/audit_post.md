# AUDITORÍA FINAL READ-ONLY DE 13 TABLAS FAREGAS

## A. Lista completa de FK y acciones ON DELETE / ON UPDATE
| Tabla Origen | Columna Origen | Tabla Destino | Columna Destino | ON UPDATE | ON DELETE |
|---|---|---|---|---|---|
| fg_certificado | cliente_id | fg_cliente | id | CASCADE | NO ACTION |
| fg_certificado | planta_key | fg_planta | key | CASCADE | NO ACTION |
| fg_certificado | tipo_certificado_clave | fg_tipo_certificado | clave | CASCADE | NO ACTION |
| fg_certificado | usuario_creacion | fg_usuario | username | CASCADE | NO ACTION |
| fg_certificado | usuario_modificacion | fg_usuario | username | CASCADE | NO ACTION |
| fg_certificado_conformidad | certificado_id | fg_certificado | id | CASCADE | CASCADE |
| fg_certificado_glp | certificado_id | fg_certificado | id | CASCADE | CASCADE |
| fg_certificado_glp | taller_autorizado_id | fg_taller_autorizado | id | CASCADE | NO ACTION |
| fg_certificado_glp_componente | certificado_id | fg_certificado_glp | certificado_id | CASCADE | CASCADE |
| fg_certificado_glp_verificacion | certificado_id | fg_certificado_glp | certificado_id | CASCADE | CASCADE |
| fg_certificado_gnv | certificado_id | fg_certificado | id | CASCADE | CASCADE |
| fg_certificado_gnv | taller_autorizado_id | fg_taller_autorizado | id | CASCADE | NO ACTION |
| fg_certificado_gnv_verificacion | certificado_id | fg_certificado_gnv | certificado_id | CASCADE | CASCADE |
| fg_certificado_titular | certificado_id | fg_certificado | id | CASCADE | CASCADE |
| fg_certificado_titular | cliente_id | fg_cliente | id | CASCADE | NO ACTION |
| fg_certificado_vehiculo | certificado_id | fg_certificado | id | CASCADE | CASCADE |
| fg_correlativo_certificado | tipo_certificado_clave | fg_tipo_certificado | clave | CASCADE | NO ACTION |

## B. FK que usan ON DELETE CASCADE
- fg_certificado_conformidad.certificado_id -> fg_certificado.id
- fg_certificado_glp.certificado_id -> fg_certificado.id
- fg_certificado_glp_componente.certificado_id -> fg_certificado_glp.certificado_id
- fg_certificado_glp_verificacion.certificado_id -> fg_certificado_glp.certificado_id
- fg_certificado_gnv.certificado_id -> fg_certificado.id
- fg_certificado_gnv_verificacion.certificado_id -> fg_certificado_gnv.certificado_id
- fg_certificado_titular.certificado_id -> fg_certificado.id
- fg_certificado_vehiculo.certificado_id -> fg_certificado.id

## C. Consecuencia de eliminar un fg_certificado
Si se ejecuta `DELETE FROM fg_certificado WHERE id = X`, ocurriría lo siguiente:
**Se eliminarían automáticamente en cascada:**
- fg_certificado_conformidad
- fg_certificado_glp
- fg_certificado_gnv
- fg_certificado_titular
- fg_certificado_vehiculo

*Resultado: El DELETE eliminaría la cabecera del certificado y todos sus registros en estas tablas hijas automáticamente.*

## D. Índices Redundantes Encontrados
- Redundancia en **fg_certificado.numero_certificado**:
  - Índice principal/único: fg_certificado_numero_certificado_key
  - Índice manual redundante: idx_fg_certificado_nro
- Redundancia en **fg_certificado_glp_componente.certificado_id**:
  - Índice principal/único: fg_certificado_glp_componente_certificado_id_orden_key
  - Índice manual redundante: idx_fg_cert_glp_comp_cert
- Redundancia en **fg_certificado_glp_verificacion.certificado_id**:
  - Índice principal/único: fg_certificado_glp_verificacion_certificado_id_codigo_key
  - Índice manual redundante: idx_fg_cert_glp_verif_cert
- Redundancia en **fg_certificado_gnv_verificacion.certificado_id**:
  - Índice principal/único: fg_certificado_gnv_verificacion_certificado_id_codigo_key
  - Índice manual redundante: idx_fg_cert_gnv_verif_cert
- Redundancia en **fg_certificado_titular.certificado_id**:
  - Índice principal/único: fg_certificado_titular_certificado_id_orden_key
  - Índice manual redundante: idx_fg_cert_titular_cert

