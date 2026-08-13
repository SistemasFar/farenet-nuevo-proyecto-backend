# AUDITORÍA COMPLETA READ-ONLY DE BD PARA FAREGAS

## A. INVENTARIO GENERAL DE BD
**Total de Tablas:** 202
**Tablas FAREGAS (fg_*):** 9
**Tablas Operativas FARENET:** 175
**Tablas de Auditoría/Log FARENET:** 18

## B. TABLAS RELACIONADAS CON VEHÍCULOS
Las siguientes tablas contienen nombres relacionados a vehículos:
- carroceria (Rows: 1332)
- categoria (Rows: 14)
- categoria_aud (Rows: 0)
- color (Rows: 17010)
- combustible (Rows: 29)
- marca (Rows: 2373)
- modelo (Rows: 39547)
- placa_consulta_log (Rows: 0)
- placa_refresh_checkpoint (Rows: 0)
- placa_status_cache (Rows: 0)
- placas_validas_cache (Rows: 0)
- subnorma_categoria (Rows: 22380)
- subnorma_categorias (Rows: 0)
- tipoplaca (Rows: 4)
- vehiculo (Rows: 982995)
- vehiculo_aud (Rows: 0)
- vehiculoclase (Rows: 360)
- vehiculoclase_aud (Rows: 0)

## C. TABLA PRINCIPAL DE VEHÍCULO Y SU ESTRUCTURA
### vehiculo
Representa el registro principal de vehículos en el sistema. Identifica al vehículo principalmente por placa/VIN.
| Columna | Tipo | Nulo |
|---|---|---|
| nromotor | character varying | undefined |
| estado | boolean | undefined |
| fechcreacion | timestamp without time zone | undefined |
| fechmodi | timestamp without time zone | undefined |
| alto | double precision | undefined |
| ancho | double precision | undefined |
| aniofabricacion | integer | undefined |
| cargautil | double precision | undefined |
| categoriaextra | character varying | undefined |
| distanciaeje1 | real | undefined |
| distanciaeje2 | real | undefined |
| distanciaeje3 | real | undefined |
| distanciaeje4 | real | undefined |
| fechfintarjetapropiedad | timestamp without time zone | undefined |
| fechiniciotarjetapropiedad | timestamp without time zone | undefined |
| kilometraje | double precision | undefined |
| longitud | double precision | undefined |
| nroasientos | integer | undefined |
| nrocilindros | integer | undefined |
| nroejes | integer | undefined |
| nropasajeros | integer | undefined |
| nropisos | integer | undefined |
| nroplacaantigua | character varying | undefined |
| nropuertas | integer | undefined |
| nroruedas | integer | undefined |
| nrosalidaemergencia | integer | undefined |
| nroserie | character varying | undefined |
| nrosoat | character varying | undefined |
| pesobruto | double precision | undefined |
| pesoseco | double precision | undefined |
| usuariocreacion_username | character varying | undefined |
| usuariomodi_id | character varying | undefined |
| aseguradora_key | character varying | undefined |
| carroceria_key | character varying | undefined |
| categoria_key | character varying | undefined |
| color_key | character varying | undefined |
| combustible_key | character varying | undefined |
| marca_key | character varying | undefined |
| marcacarroceria | character varying | undefined |
| modelo_key | character varying | undefined |
| vehiculoclase_key | character varying | undefined |
| tipopoliza_key | character varying | undefined |
| tarjetapropiedad_id | bigint | undefined |
| codigocertificado | character varying | undefined |
| empcertificadoragas | character varying | undefined |
| fechemision | timestamp without time zone | undefined |
| sindctos | boolean | undefined |
| empcertificadoragas_key | integer | undefined |
| certificadora_gas_key | integer | undefined |

**Constraints/Relaciones:**
- PRIMARY KEY: nromotor -> vehiculo(nromotor)

## D. CATÁLOGOS VEHICULARES
- **marca**: (Rows: 2373) POTENCIALMENTE COMPARTIBLE.
- **modelo**: (Rows: 39547) POTENCIALMENTE COMPARTIBLE.
- **categoria**: (Rows: 14) POTENCIALMENTE COMPARTIBLE.
- **color**: (Rows: 17010) POTENCIALMENTE COMPARTIBLE.
- **combustible**: (Rows: 29) POTENCIALMENTE COMPARTIBLE.
- **carroceria**: (Rows: 1332) POTENCIALMENTE COMPARTIBLE.
- **vehiculoclase**: (Rows: 360) POTENCIALMENTE COMPARTIBLE.

## E. PERSONAS / PROPIETARIOS / CLIENTES
- **campanias_personas**: (Rows: 1)
- **campersonasnuevas**: (Rows: 0)
- **descuento_cliente_inspecciones**: (Rows: 0)
- **descuento_masivo_cliente_inspecciones**: (Rows: 0)
- **descuentocliente**: (Rows: 2399028)
- **descuentocliente_inspecciones**: (Rows: 0)
- **descuentodetalle_descuentocliente**: (Rows: 7354151)
- **descuentomasivocliente**: (Rows: 512413)
- **descuentomasivocliente_inspecciones**: (Rows: 0)
- **empresa**: (Rows: 14)
- **empresa_convenio**: (Rows: 231)
- **persona**: (Rows: 1139360)
- **persona_aud**: (Rows: 1)
- **persona_error**: (Rows: 35)
- **usuario_empresa**: (Rows: 12)

NOTA: LOS CLIENTES DE FAREGAS SON DISTINTOS DE LOS CLIENTES DE FARENET. La tabla 'persona' es genérica y puede ser POTENCIALMENTE COMPARTIBLE como maestro de DNI/RUC, pero la relación comercial (clientes) podría requerir separación.

## F. TALLERES AUTORIZADOS
- **t_conversiones**: (Rows: 0)

## G. INFORMACIÓN GLP EXISTENTE
NO ENCONTRADO.

## H. INFORMACIÓN GNV EXISTENTE
- alerta_inspeccion
- alerta_inspeccion_aud
- conceptoinspeccion
- conceptoinspecciondetalle
- descuento_cliente_inspecciones
- descuento_masivo_cliente_inspecciones
- descuentocliente_inspecciones
- descuentomasivocliente_inspecciones
- inspeccion
- inspeccion_aud
- inspeccionestado
- periodoreinspeccion
- tipoinspeccion
- tmp_inspeccion

## I. INFORMACIÓN CONFORMIDAD EXISTENTE
NO ENCONTRADO.

## J. PAGOS
- **formapago**: (Rows: 3)
- **pago**: (Rows: 43565)
- **pago_aud**: (Rows: 1)
- **tipopagodescuento**: (Rows: 3)

## K. COMPROBANTES / FACTURACIÓN
- **comprobante**: (Rows: 48193)
- **comprobante_aud**: (Rows: 5)
- **comprobanteestado**: (Rows: 3)
- **descuentocomprobante**: (Rows: 15361)
- **st_comprobantes**: (Rows: 0)

## L. CORRELATIVOS / CERTIFICADOS
- **certificado**: (Rows: 43414)
- **certificado_error**: (Rows: 42)
- **certificadoragas**: (Rows: 23)
- **condicionvigenciacertificado**: (Rows: 4)
- **dms_certificadores_vehiculares**: (Rows: 0)
- **seriedocumento**: (Rows: 45)
- **seriedocumento_base**: (Rows: 0)
- **seriedocumentobase**: (Rows: 29)
- **seriedocumentoot**: (Rows: 11)
- **tipocertificado**: (Rows: 29)

## M. TABLAS FAREGAS YA EXISTENTES
- **fg_auditoria_acceso**: (Rows: 32) - FAREGAS EXISTENTE.
- **fg_perfil**: (Rows: 2) - FAREGAS EXISTENTE.
- **fg_perfil_permiso**: (Rows: 4) - FAREGAS EXISTENTE.
- **fg_perfil_planta**: (Rows: 33) - FAREGAS EXISTENTE.
- **fg_permiso**: (Rows: 3) - FAREGAS EXISTENTE.
- **fg_planta**: (Rows: 29) - FAREGAS EXISTENTE.
- **fg_usuario**: (Rows: 4) - FAREGAS EXISTENTE.
- **fg_usuario_planta**: (Rows: 2) - FAREGAS EXISTENTE.
- **fg_usuario_sesion**: (Rows: 47) - FAREGAS EXISTENTE.

## N. MAPA DE RELACIONES
```text
vehiculo
   +-- marca_id -> marca
   +-- modelo_id -> modelo
   +-- categoria_id -> categoria
   +-- color_id -> color
   +-- combustible_id -> combustible
```

## O. MATRIZ COMPLETA: CAMPO CERTIFICADO → TABLA/COLUMNA ACTUAL
| CAMPO | TABLA ACTUAL | COLUMNA ACTUAL | EXISTE | OBSERVACIÓN |
|---|---|---|---|---|
| Placa | vehiculo | nroplacaantigua | SI | Potencialmente compartible |
| Categoría | vehiculo | categoriaextra | SI | Potencialmente compartible |
| Clase | vehiculo | vehiculoclase_key | SI | Potencialmente compartible |
| Marca | vehiculo | marca_key | SI | Potencialmente compartible |
| Modelo | vehiculo | modelo_key | SI | Potencialmente compartible |
| Versión | vehiculo | - | NO | Falta |
| Año Fabricación | vehiculo | aniofabricacion | SI | Potencialmente compartible |
| Año Modelo | vehiculo | modelo_key | SI | Potencialmente compartible |
| VIN / Serie / Chasis | vehiculo | - | NO | Falta |
| Motor | vehiculo | nromotor | SI | Potencialmente compartible |
| Combustible | vehiculo | combustible_key | SI | Potencialmente compartible |
| Color | vehiculo | color_key | SI | Potencialmente compartible |
| Carrocería | vehiculo | carroceria_key | SI | Potencialmente compartible |
| Cilindros | vehiculo | nrocilindros | SI | Potencialmente compartible |
| Cilindrada | vehiculo | - | NO | Falta |
| Ejes | vehiculo | distanciaeje1 | SI | Potencialmente compartible |
| Ruedas | vehiculo | nroruedas | SI | Potencialmente compartible |
| Asientos | vehiculo | nroasientos | SI | Potencialmente compartible |
| Pasajeros | vehiculo | nropasajeros | SI | Potencialmente compartible |
| Largo | vehiculo | - | NO | Falta |
| Ancho | vehiculo | ancho | SI | Potencialmente compartible |
| Alto | vehiculo | alto | SI | Potencialmente compartible |
| Peso Neto | vehiculo | pesobruto | SI | Potencialmente compartible |
| Peso Bruto | vehiculo | pesobruto | SI | Potencialmente compartible |
| Carga Útil | vehiculo | cargautil | SI | Potencialmente compartible |
| Potencia | vehiculo | - | NO | Falta |
| Fórmula Rodante | vehiculo | - | NO | Falta |

## P. TABLAS POTENCIALMENTE COMPARTIBLES
- vehiculo
- marca
- modelo
- categoria
- vehiculoclase
- color
- combustible
- carroceria
- persona (sólo como maestro de RUC/DNI)

## Q. TABLAS FARENET QUE NO DEBEN TOCARSE
- inspeccion
- inspeccionestado
- ordentrabajo
- certificado (es específico de FARENET)
- comprobante
- pago

## R. DATOS QUE NO EXISTEN Y QUE FAREGAS NECESITARÁ
- Talleres de conversión (y autorizados).
- Componentes GLP (cilindro, regulador, marca, serie).
- Componentes GNV (kit, cilindro, PEC).
- Modificaciones para Conformidad (motivo, montaje, uso original).
- Certificados específicos GNV, GLP, Conformidad.

## S. DUDAS/DECISIONES QUE NECESITAN MI APROBACIÓN
1. ¿Deseas que creemos una tabla separada `fg_vehiculo` o reutilizamos la tabla `vehiculo` agregándole las columnas faltantes (si existieran)? (Recomendado: Compartir maestro de vehículos).
2. ¿Deseas que los Clientes de FAREGAS usen la tabla `persona` genérica para guardar nombres/RUC, y creemos una tabla `fg_cliente` para la relación comercial?
3. Los correlativos de certificados GLP/GNV/Conformidad deberán crearse en nuevas tablas (ej. `fg_certificado_glp`, `fg_certificado_gnv`). ¿Apruebas el diseño de estas nuevas entidades basándonos en los datos faltantes?

## T. BD MODIFICADA
NO

## U. CÓDIGO MODIFICADO
NO
