# DOCUMENTACION BASE DE DATOS FAREGAS

FAREGAS YA CREADAS (22)

Divididas en:
A. Seguridad / configuración / acceso: 9
B. Operación de certificados: 13

## MAESTROS COMPARTIDOS

FAREGAS consulta maestros vehiculares existentes en FARENET:
- vehiculo
- marca
- modelo
- categoria
- vehiculoclase
- color
- combustible
- carroceria

IMPORTANTE: Estas NO son tablas fg_*. NO incluir CREATE TABLE de estas tablas dentro del instalador FAREGAS. FAREGAS únicamente las utiliza posteriormente como fuente de consulta / autocompletado.

## CLIENTES

FARENET -> sus propios clientes / persona

FAREGAS -> fg_cliente

NO existe FK: fg_cliente -> persona. FAREGAS mantiene sus clientes independientemente. Puede consultar información FARENET para autocompletar posteriormente, pero el registro propio permanece en fg_cliente.

## MODELO OPERATIVO DE CERTIFICADOS FAREGAS

### fg_cliente

**Objetivo funcional**: Almacena información sobre fg_cliente.

**Tabla de Columnas:**
| COLUMNA | TIPO | LONGITUD/PRECISIÓN | NULL | DEFAULT | PK/FK |
| --- | --- | --- | --- | --- | --- |
| id | bigint | 64 | NOT NULL | nextval('fg_cliente_id_seq'::regclass) | PK |
| tipo_documento | character varying | 10 | NOT NULL | - |  |
| nro_documento | character varying | 20 | NOT NULL | - |  |
| nombre_razon_social | character varying | 300 | NOT NULL | - |  |
| direccion | character varying | 500 | NULL | - |  |
| telefono | character varying | 30 | NULL | - |  |
| correo | character varying | 200 | NULL | - |  |
| estado | boolean | - | NOT NULL | true |  |
| fecha_creacion | timestamp without time zone | - | NOT NULL | CURRENT_TIMESTAMP |  |
| fecha_modificacion | timestamp without time zone | - | NULL | - |  |

**PRIMARY KEY:**
- fg_cliente_pkey (id)

**FOREIGN KEYS:**
- Ninguna

**UNIQUE:**
- **fg_cliente_tipo_documento_nro_documento_key**: (tipo_documento, tipo_documento, nro_documento, nro_documento)

**CHECK:**
- **2200_172097_1_not_null**: id IS NOT NULL
- **2200_172097_2_not_null**: tipo_documento IS NOT NULL
- **2200_172097_3_not_null**: nro_documento IS NOT NULL
- **2200_172097_4_not_null**: nombre_razon_social IS NOT NULL
- **2200_172097_8_not_null**: estado IS NOT NULL
- **2200_172097_9_not_null**: fecha_creacion IS NOT NULL

**Índices:**
- **fg_cliente_pkey**: 
  ```sql
  CREATE UNIQUE INDEX fg_cliente_pkey ON public.fg_cliente USING btree (id);
  ```
- **fg_cliente_tipo_documento_nro_documento_key**: 
  ```sql
  CREATE UNIQUE INDEX fg_cliente_tipo_documento_nro_documento_key ON public.fg_cliente USING btree (tipo_documento, nro_documento);
  ```

**Script CREATE TABLE REAL:**
```sql
CREATE TABLE fg_cliente (
  id bigint NOT NULL DEFAULT nextval('fg_cliente_id_seq'::regclass),
  tipo_documento character varying(10) NOT NULL,
  nro_documento character varying(20) NOT NULL,
  nombre_razon_social character varying(300) NOT NULL,
  direccion character varying(500),
  telefono character varying(30),
  correo character varying(200),
  estado boolean NOT NULL DEFAULT true,
  fecha_creacion timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  fecha_modificacion timestamp without time zone,
  CONSTRAINT fg_cliente_pkey PRIMARY KEY (id)
);
```

### fg_tipo_certificado

**Objetivo funcional**: Almacena información sobre fg_tipo_certificado.

**Valores actuales:**
- GNV_ANUAL -> 22
- GLP_ANUAL -> 41
- CONFORMIDAD -> 39

DG es el prefijo común. 22 = GNV, 41 = GLP, 39 = CONFORMIDAD. La numeración futura se construirá conceptualmente como: DG-{codigo_tipo}-{correlativo}.

**Tabla de Columnas:**
| COLUMNA | TIPO | LONGITUD/PRECISIÓN | NULL | DEFAULT | PK/FK |
| --- | --- | --- | --- | --- | --- |
| clave | character varying | 30 | NOT NULL | - | PK |
| nombre | character varying | 100 | NOT NULL | - |  |
| descripcion | character varying | 300 | NULL | - |  |
| activo | boolean | - | NOT NULL | true |  |
| entidad_certificadora_nombre | character varying | 300 | NULL | - |  |
| resolucion_directoral | character varying | 150 | NULL | - |  |
| domicilio_fiscal | character varying | 500 | NULL | - |  |
| telefono | character varying | 30 | NULL | - |  |
| lugar_emision | character varying | 150 | NULL | - |  |
| codigo | character varying | 2 | NOT NULL | - |  |

**PRIMARY KEY:**
- fg_tipo_certificado_pkey (clave)

**FOREIGN KEYS:**
- Ninguna

**UNIQUE:**
- **fg_tipo_certificado_codigo_key**: (codigo)

**CHECK:**
- **2200_172110_1_not_null**: clave IS NOT NULL
- **2200_172110_2_not_null**: nombre IS NOT NULL
- **2200_172110_4_not_null**: activo IS NOT NULL
- **2200_172110_10_not_null**: codigo IS NOT NULL

**Índices:**
- **fg_tipo_certificado_pkey**: 
  ```sql
  CREATE UNIQUE INDEX fg_tipo_certificado_pkey ON public.fg_tipo_certificado USING btree (clave);
  ```
- **fg_tipo_certificado_codigo_key**: 
  ```sql
  CREATE UNIQUE INDEX fg_tipo_certificado_codigo_key ON public.fg_tipo_certificado USING btree (codigo);
  ```

**Script CREATE TABLE REAL:**
```sql
CREATE TABLE fg_tipo_certificado (
  clave character varying(30) NOT NULL,
  nombre character varying(100) NOT NULL,
  descripcion character varying(300),
  activo boolean NOT NULL DEFAULT true,
  entidad_certificadora_nombre character varying(300),
  resolucion_directoral character varying(150),
  domicilio_fiscal character varying(500),
  telefono character varying(30),
  lugar_emision character varying(150),
  codigo character varying(2) NOT NULL,
  CONSTRAINT fg_tipo_certificado_pkey PRIMARY KEY (clave)
);
```

### fg_correlativo_certificado

**Objetivo funcional**: Almacena información sobre fg_correlativo_certificado.

**Regla Funcional de Rangos**:
Los rangos son asignados según PLANTA + TIPO DE CERTIFICADO.

Semántica:
- nro_inicio = primer número permitido.
- nro_actual = último número ya utilizado.
- nro_maximo = último número permitido.
Para un rango nuevo: nro_actual = nro_inicio - 1

**Historial de Rangos**:
Conserva múltiples rangos históricos para una misma planta + tipo. NO se sobrescriben rangos anteriores. Existe solamente un rango activo simultáneamente para planta + tipo.

**Protección Contra Solapamiento**:
La constraint excl_fg_correlativo_rango utiliza EXCLUDE USING gist con:
planta_key WITH =, tipo_certificado_clave WITH =, int8range(nro_inicio, nro_maximo, '[]') WITH &&

Para la misma planta + tipo: 101-200 y 150-250 NO está permitido. Pero 101-200 y 201-300 SÍ está permitido.

**Tabla de Columnas:**
| COLUMNA | TIPO | LONGITUD/PRECISIÓN | NULL | DEFAULT | PK/FK |
| --- | --- | --- | --- | --- | --- |
| id | bigint | 64 | NOT NULL | nextval('fg_correlativo_certificado_id_seq'::regclass) | PK |
| tipo_certificado_clave | character varying | 30 | NOT NULL | - | FK |
| nro_actual | bigint | 64 | NOT NULL | 0 |  |
| activo | boolean | - | NOT NULL | true |  |
| fecha_modificacion | timestamp without time zone | - | NOT NULL | CURRENT_TIMESTAMP |  |
| planta_key | character varying | 20 | NOT NULL | - | FK |
| nro_inicio | bigint | 64 | NOT NULL | - |  |
| nro_maximo | bigint | 64 | NOT NULL | - |  |
| fecha_asignacion | timestamp without time zone | - | NOT NULL | CURRENT_TIMESTAMP |  |
| fecha_cierre | timestamp without time zone | - | NULL | - |  |

**PRIMARY KEY:**
- fg_correlativo_certificado_pkey (id)

**FOREIGN KEYS:**
- **fk_correlativo_tipo**: (tipo_certificado_clave) -> fg_tipo_certificado (clave). ON UPDATE CASCADE ON DELETE NO ACTION
- **fk_correlativo_planta**: (planta_key) -> fg_planta (key). ON UPDATE CASCADE ON DELETE NO ACTION

**UNIQUE:**
- **fg_correlativo_certificado_hist_key**: (planta_key, planta_key, planta_key, planta_key, tipo_certificado_clave, tipo_certificado_clave, tipo_certificado_clave, tipo_certificado_clave, nro_inicio, nro_inicio, nro_inicio, nro_inicio, nro_maximo, nro_maximo, nro_maximo, nro_maximo)

**CHECK:**
- **chk_cierre**: (((activo = false) OR (fecha_cierre IS NULL)))
- **chk_nro_inicio**: ((nro_inicio > 0))
- **chk_nro_maximo**: ((nro_maximo >= nro_inicio))
- **chk_nro_actual_min**: ((nro_actual >= (nro_inicio - 1)))
- **chk_nro_actual_max**: ((nro_actual <= nro_maximo))
- **2200_172121_1_not_null**: id IS NOT NULL
- **2200_172121_2_not_null**: tipo_certificado_clave IS NOT NULL
- **2200_172121_4_not_null**: nro_actual IS NOT NULL
- **2200_172121_5_not_null**: activo IS NOT NULL
- **2200_172121_6_not_null**: fecha_modificacion IS NOT NULL
- **2200_172121_7_not_null**: planta_key IS NOT NULL
- **2200_172121_8_not_null**: nro_inicio IS NOT NULL
- **2200_172121_9_not_null**: nro_maximo IS NOT NULL
- **2200_172121_10_not_null**: fecha_asignacion IS NOT NULL

**Índices:**
- **fg_correlativo_certificado_pkey**: 
  ```sql
  CREATE UNIQUE INDEX fg_correlativo_certificado_pkey ON public.fg_correlativo_certificado USING btree (id);
  ```
- **fg_correlativo_certificado_hist_key**: 
  ```sql
  CREATE UNIQUE INDEX fg_correlativo_certificado_hist_key ON public.fg_correlativo_certificado USING btree (planta_key, tipo_certificado_clave, nro_inicio, nro_maximo);
  ```
- **fg_correlativo_certificado_activo_idx**: 
  ```sql
  CREATE UNIQUE INDEX fg_correlativo_certificado_activo_idx ON public.fg_correlativo_certificado USING btree (planta_key, tipo_certificado_clave) WHERE (activo = true);
  ```
- **excl_fg_correlativo_rango**: 
  ```sql
  CREATE INDEX excl_fg_correlativo_rango ON public.fg_correlativo_certificado USING gist (planta_key, tipo_certificado_clave, int8range(nro_inicio, nro_maximo, '[]'::text));
  ```

**Script CREATE TABLE REAL:**
```sql
CREATE TABLE fg_correlativo_certificado (
  id bigint NOT NULL DEFAULT nextval('fg_correlativo_certificado_id_seq'::regclass),
  tipo_certificado_clave character varying(30) NOT NULL,
  nro_actual bigint NOT NULL DEFAULT 0,
  activo boolean NOT NULL DEFAULT true,
  fecha_modificacion timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  planta_key character varying(20) NOT NULL,
  nro_inicio bigint NOT NULL,
  nro_maximo bigint NOT NULL,
  fecha_asignacion timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  fecha_cierre timestamp without time zone,
  CONSTRAINT fg_correlativo_certificado_pkey PRIMARY KEY (id)
);
```

### fg_certificado

**Objetivo funcional**: Almacena información sobre fg_certificado.

**Tabla de Columnas:**
| COLUMNA | TIPO | LONGITUD/PRECISIÓN | NULL | DEFAULT | PK/FK |
| --- | --- | --- | --- | --- | --- |
| id | bigint | 64 | NOT NULL | nextval('fg_certificado_id_seq'::regclass) | PK |
| tipo_certificado_clave | character varying | 30 | NOT NULL | - | FK |
| numero_certificado | character varying | 50 | NULL | - |  |
| cliente_id | bigint | 64 | NULL | - | FK |
| planta_key | character varying | 20 | NOT NULL | - | FK |
| fecha_emision | date | - | NULL | - |  |
| estado | character varying | 30 | NULL | - |  |
| observaciones | text | - | NULL | - |  |
| usuario_creacion | character varying | 255 | NOT NULL | - | FK |
| fecha_creacion | timestamp without time zone | - | NOT NULL | CURRENT_TIMESTAMP |  |
| usuario_modificacion | character varying | 255 | NULL | - | FK |
| fecha_modificacion | timestamp without time zone | - | NULL | - |  |
| entidad_certificadora_nombre | character varying | 300 | NULL | - |  |
| resolucion_directoral | character varying | 150 | NULL | - |  |
| domicilio_fiscal | character varying | 500 | NULL | - |  |
| telefono_certificadora | character varying | 30 | NULL | - |  |
| lugar_emision | character varying | 150 | NULL | - |  |

**PRIMARY KEY:**
- fg_certificado_pkey (id)

**FOREIGN KEYS:**
- **fk_certificado_tipo**: (tipo_certificado_clave) -> fg_tipo_certificado (clave). ON UPDATE CASCADE ON DELETE NO ACTION
- **fk_certificado_cliente**: (cliente_id) -> fg_cliente (id). ON UPDATE CASCADE ON DELETE NO ACTION
- **fk_certificado_planta**: (planta_key) -> fg_planta (key). ON UPDATE CASCADE ON DELETE NO ACTION
- **fk_certificado_usuarioc**: (usuario_creacion) -> fg_usuario (username). ON UPDATE CASCADE ON DELETE NO ACTION
- **fk_certificado_usuariom**: (usuario_modificacion) -> fg_usuario (username). ON UPDATE CASCADE ON DELETE NO ACTION

**UNIQUE:**
- **fg_certificado_numero_certificado_key**: (numero_certificado)

**CHECK:**
- **2200_172139_1_not_null**: id IS NOT NULL
- **2200_172139_2_not_null**: tipo_certificado_clave IS NOT NULL
- **2200_172139_5_not_null**: planta_key IS NOT NULL
- **2200_172139_9_not_null**: usuario_creacion IS NOT NULL
- **2200_172139_10_not_null**: fecha_creacion IS NOT NULL

**Índices:**
- **fg_certificado_pkey**: 
  ```sql
  CREATE UNIQUE INDEX fg_certificado_pkey ON public.fg_certificado USING btree (id);
  ```
- **fg_certificado_numero_certificado_key**: 
  ```sql
  CREATE UNIQUE INDEX fg_certificado_numero_certificado_key ON public.fg_certificado USING btree (numero_certificado);
  ```
- **idx_fg_certificado_tipo**: 
  ```sql
  CREATE INDEX idx_fg_certificado_tipo ON public.fg_certificado USING btree (tipo_certificado_clave);
  ```
- **idx_fg_certificado_cli**: 
  ```sql
  CREATE INDEX idx_fg_certificado_cli ON public.fg_certificado USING btree (cliente_id);
  ```
- **idx_fg_certificado_planta**: 
  ```sql
  CREATE INDEX idx_fg_certificado_planta ON public.fg_certificado USING btree (planta_key);
  ```
- **idx_fg_certificado_fecha**: 
  ```sql
  CREATE INDEX idx_fg_certificado_fecha ON public.fg_certificado USING btree (fecha_emision);
  ```
- **idx_fg_certificado_estado**: 
  ```sql
  CREATE INDEX idx_fg_certificado_estado ON public.fg_certificado USING btree (estado);
  ```

**Script CREATE TABLE REAL:**
```sql
CREATE TABLE fg_certificado (
  id bigint NOT NULL DEFAULT nextval('fg_certificado_id_seq'::regclass),
  tipo_certificado_clave character varying(30) NOT NULL,
  numero_certificado character varying(50),
  cliente_id bigint,
  planta_key character varying(20) NOT NULL,
  fecha_emision date,
  estado character varying(30),
  observaciones text,
  usuario_creacion character varying(255) NOT NULL,
  fecha_creacion timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  usuario_modificacion character varying(255),
  fecha_modificacion timestamp without time zone,
  entidad_certificadora_nombre character varying(300),
  resolucion_directoral character varying(150),
  domicilio_fiscal character varying(500),
  telefono_certificadora character varying(30),
  lugar_emision character varying(150),
  CONSTRAINT fg_certificado_pkey PRIMARY KEY (id)
);
```

### fg_certificado_vehiculo

**Objetivo funcional**: Almacena información sobre fg_certificado_vehiculo.

**Tabla de Columnas:**
| COLUMNA | TIPO | LONGITUD/PRECISIÓN | NULL | DEFAULT | PK/FK |
| --- | --- | --- | --- | --- | --- |
| certificado_id | bigint | 64 | NOT NULL | - | PK/FK |
| placa | character varying | 255 | NULL | - |  |
| categoria | character varying | 255 | NULL | - |  |
| clase | character varying | 255 | NULL | - |  |
| marca | character varying | 255 | NULL | - |  |
| modelo | character varying | 255 | NULL | - |  |
| version | character varying | 255 | NULL | - |  |
| anio_fabricacion | character varying | 10 | NULL | - |  |
| anio_modelo | character varying | 10 | NULL | - |  |
| vin | character varying | 255 | NULL | - |  |
| serie_chasis | character varying | 255 | NULL | - |  |
| numero_motor | character varying | 255 | NULL | - |  |
| combustible | character varying | 255 | NULL | - |  |
| color | character varying | 255 | NULL | - |  |
| carroceria | character varying | 255 | NULL | - |  |
| numero_cilindros | integer | 32 | NULL | - |  |
| cilindrada | numeric | 10 | NULL | - |  |
| numero_ejes | integer | 32 | NULL | - |  |
| numero_ruedas | integer | 32 | NULL | - |  |
| numero_asientos | integer | 32 | NULL | - |  |
| numero_pasajeros | integer | 32 | NULL | - |  |
| longitud | numeric | 10 | NULL | - |  |
| ancho | numeric | 10 | NULL | - |  |
| alto | numeric | 10 | NULL | - |  |
| peso_neto | numeric | 10 | NULL | - |  |
| peso_bruto | numeric | 10 | NULL | - |  |
| carga_util | numeric | 10 | NULL | - |  |
| potencia | character varying | 100 | NULL | - |  |
| formula_rodante | character varying | 50 | NULL | - |  |

**PRIMARY KEY:**
- fg_certificado_vehiculo_pkey (certificado_id)

**FOREIGN KEYS:**
- **fk_cert_vehiculo_cert**: (certificado_id) -> fg_certificado (id). ON UPDATE CASCADE ON DELETE CASCADE

**UNIQUE:**
- Ninguna

**CHECK:**
- **2200_172182_1_not_null**: certificado_id IS NOT NULL

**Índices:**
- **fg_certificado_vehiculo_pkey**: 
  ```sql
  CREATE UNIQUE INDEX fg_certificado_vehiculo_pkey ON public.fg_certificado_vehiculo USING btree (certificado_id);
  ```

**Script CREATE TABLE REAL:**
```sql
CREATE TABLE fg_certificado_vehiculo (
  certificado_id bigint NOT NULL,
  placa character varying(255),
  categoria character varying(255),
  clase character varying(255),
  marca character varying(255),
  modelo character varying(255),
  version character varying(255),
  anio_fabricacion character varying(10),
  anio_modelo character varying(10),
  vin character varying(255),
  serie_chasis character varying(255),
  numero_motor character varying(255),
  combustible character varying(255),
  color character varying(255),
  carroceria character varying(255),
  numero_cilindros integer,
  cilindrada numeric,
  numero_ejes integer,
  numero_ruedas integer,
  numero_asientos integer,
  numero_pasajeros integer,
  longitud numeric,
  ancho numeric,
  alto numeric,
  peso_neto numeric,
  peso_bruto numeric,
  carga_util numeric,
  potencia character varying(100),
  formula_rodante character varying(50),
  CONSTRAINT fg_certificado_vehiculo_pkey PRIMARY KEY (certificado_id)
);
```

### fg_certificado_titular

**Objetivo funcional**: Almacena información sobre fg_certificado_titular.

**Tabla de Columnas:**
| COLUMNA | TIPO | LONGITUD/PRECISIÓN | NULL | DEFAULT | PK/FK |
| --- | --- | --- | --- | --- | --- |
| id | bigint | 64 | NOT NULL | nextval('fg_certificado_titular_id_seq'::regclass) | PK |
| certificado_id | bigint | 64 | NOT NULL | - | FK |
| cliente_id | bigint | 64 | NULL | - | FK |
| orden | smallint | 16 | NOT NULL | - |  |
| tipo_documento | character varying | 10 | NULL | - |  |
| nro_documento | character varying | 20 | NULL | - |  |
| nombre_razon_social | character varying | 300 | NOT NULL | - |  |
| direccion | character varying | 500 | NULL | - |  |

**PRIMARY KEY:**
- fg_certificado_titular_pkey (id)

**FOREIGN KEYS:**
- **fk_cert_titular_cert**: (certificado_id) -> fg_certificado (id). ON UPDATE CASCADE ON DELETE CASCADE
- **fk_cert_titular_cliente**: (cliente_id) -> fg_cliente (id). ON UPDATE CASCADE ON DELETE NO ACTION

**UNIQUE:**
- **fg_certificado_titular_certificado_id_orden_key**: (certificado_id, certificado_id, orden, orden)

**CHECK:**
- **2200_172197_1_not_null**: id IS NOT NULL
- **2200_172197_2_not_null**: certificado_id IS NOT NULL
- **2200_172197_4_not_null**: orden IS NOT NULL
- **2200_172197_7_not_null**: nombre_razon_social IS NOT NULL

**Índices:**
- **fg_certificado_titular_pkey**: 
  ```sql
  CREATE UNIQUE INDEX fg_certificado_titular_pkey ON public.fg_certificado_titular USING btree (id);
  ```
- **fg_certificado_titular_certificado_id_orden_key**: 
  ```sql
  CREATE UNIQUE INDEX fg_certificado_titular_certificado_id_orden_key ON public.fg_certificado_titular USING btree (certificado_id, orden);
  ```
- **idx_fg_cert_titular_cli**: 
  ```sql
  CREATE INDEX idx_fg_cert_titular_cli ON public.fg_certificado_titular USING btree (cliente_id);
  ```

**Script CREATE TABLE REAL:**
```sql
CREATE TABLE fg_certificado_titular (
  id bigint NOT NULL DEFAULT nextval('fg_certificado_titular_id_seq'::regclass),
  certificado_id bigint NOT NULL,
  cliente_id bigint,
  orden smallint NOT NULL,
  tipo_documento character varying(10),
  nro_documento character varying(20),
  nombre_razon_social character varying(300) NOT NULL,
  direccion character varying(500),
  CONSTRAINT fg_certificado_titular_pkey PRIMARY KEY (id)
);
```

### fg_taller_autorizado

**Objetivo funcional**: Almacena información sobre fg_taller_autorizado.

**Tabla de Columnas:**
| COLUMNA | TIPO | LONGITUD/PRECISIÓN | NULL | DEFAULT | PK/FK |
| --- | --- | --- | --- | --- | --- |
| id | bigint | 64 | NOT NULL | nextval('fg_taller_autorizado_id_seq'::regclass) | PK |
| ruc | character varying | 11 | NULL | - |  |
| razon_social | character varying | 300 | NOT NULL | - |  |
| nombre_comercial | character varying | 300 | NULL | - |  |
| sede | character varying | 200 | NULL | - |  |
| direccion | character varying | 500 | NULL | - |  |
| codigo_autorizacion | character varying | 100 | NULL | - |  |
| estado | boolean | - | NOT NULL | true |  |
| fecha_creacion | timestamp without time zone | - | NOT NULL | CURRENT_TIMESTAMP |  |
| fecha_modificacion | timestamp without time zone | - | NULL | - |  |

**PRIMARY KEY:**
- fg_taller_autorizado_pkey (id)

**FOREIGN KEYS:**
- Ninguna

**UNIQUE:**
- Ninguna

**CHECK:**
- **2200_172222_1_not_null**: id IS NOT NULL
- **2200_172222_3_not_null**: razon_social IS NOT NULL
- **2200_172222_8_not_null**: estado IS NOT NULL
- **2200_172222_9_not_null**: fecha_creacion IS NOT NULL

**Índices:**
- **fg_taller_autorizado_pkey**: 
  ```sql
  CREATE UNIQUE INDEX fg_taller_autorizado_pkey ON public.fg_taller_autorizado USING btree (id);
  ```

**Script CREATE TABLE REAL:**
```sql
CREATE TABLE fg_taller_autorizado (
  id bigint NOT NULL DEFAULT nextval('fg_taller_autorizado_id_seq'::regclass),
  ruc character varying(11),
  razon_social character varying(300) NOT NULL,
  nombre_comercial character varying(300),
  sede character varying(200),
  direccion character varying(500),
  codigo_autorizacion character varying(100),
  estado boolean NOT NULL DEFAULT true,
  fecha_creacion timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  fecha_modificacion timestamp without time zone,
  CONSTRAINT fg_taller_autorizado_pkey PRIMARY KEY (id)
);
```

### fg_certificado_gnv

**Objetivo funcional**: Almacena información sobre fg_certificado_gnv.

**Tabla de Columnas:**
| COLUMNA | TIPO | LONGITUD/PRECISIÓN | NULL | DEFAULT | PK/FK |
| --- | --- | --- | --- | --- | --- |
| certificado_id | bigint | 64 | NOT NULL | - | PK/FK |
| taller_autorizado_id | bigint | 64 | NULL | - | FK |
| vigencia_hasta | date | - | NULL | - |  |
| taller_razon_social | character varying | 300 | NULL | - |  |
| taller_sede | character varying | 200 | NULL | - |  |
| taller_direccion | character varying | 500 | NULL | - |  |
| taller_codigo_autorizacion | character varying | 100 | NULL | - |  |

**PRIMARY KEY:**
- fg_certificado_gnv_pkey (certificado_id)

**FOREIGN KEYS:**
- **fk_cert_gnv_cert**: (certificado_id) -> fg_certificado (id). ON UPDATE CASCADE ON DELETE CASCADE
- **fk_cert_gnv_taller**: (taller_autorizado_id) -> fg_taller_autorizado (id). ON UPDATE CASCADE ON DELETE NO ACTION

**UNIQUE:**
- Ninguna

**CHECK:**
- **2200_172233_1_not_null**: certificado_id IS NOT NULL

**Índices:**
- **fg_certificado_gnv_pkey**: 
  ```sql
  CREATE UNIQUE INDEX fg_certificado_gnv_pkey ON public.fg_certificado_gnv USING btree (certificado_id);
  ```

**Script CREATE TABLE REAL:**
```sql
CREATE TABLE fg_certificado_gnv (
  certificado_id bigint NOT NULL,
  taller_autorizado_id bigint,
  vigencia_hasta date,
  taller_razon_social character varying(300),
  taller_sede character varying(200),
  taller_direccion character varying(500),
  taller_codigo_autorizacion character varying(100),
  CONSTRAINT fg_certificado_gnv_pkey PRIMARY KEY (certificado_id)
);
```

### fg_certificado_gnv_verificacion

**Objetivo funcional**: Almacena información sobre fg_certificado_gnv_verificacion.

**Tabla de Columnas:**
| COLUMNA | TIPO | LONGITUD/PRECISIÓN | NULL | DEFAULT | PK/FK |
| --- | --- | --- | --- | --- | --- |
| id | bigint | 64 | NOT NULL | nextval('fg_certificado_gnv_verificacion_id_seq'::regclass) | PK |
| certificado_id | bigint | 64 | NOT NULL | - | FK |
| codigo | character varying | 5 | NOT NULL | - |  |
| orden | smallint | 16 | NOT NULL | - |  |
| descripcion | text | - | NOT NULL | - |  |
| cumple | boolean | - | NOT NULL | - |  |
| observacion | text | - | NULL | - |  |

**PRIMARY KEY:**
- fg_certificado_gnv_verificacion_pkey (id)

**FOREIGN KEYS:**
- **fk_cert_gnv_verif_cert**: (certificado_id) -> fg_certificado_gnv (certificado_id). ON UPDATE CASCADE ON DELETE CASCADE

**UNIQUE:**
- **fg_certificado_gnv_verificacion_certificado_id_codigo_key**: (certificado_id, certificado_id, codigo, codigo)
- **fg_certificado_gnv_verificacion_certificado_id_orden_key**: (certificado_id, certificado_id, orden, orden)

**CHECK:**
- **2200_172253_1_not_null**: id IS NOT NULL
- **2200_172253_2_not_null**: certificado_id IS NOT NULL
- **2200_172253_3_not_null**: codigo IS NOT NULL
- **2200_172253_4_not_null**: orden IS NOT NULL
- **2200_172253_5_not_null**: descripcion IS NOT NULL
- **2200_172253_6_not_null**: cumple IS NOT NULL

**Índices:**
- **fg_certificado_gnv_verificacion_pkey**: 
  ```sql
  CREATE UNIQUE INDEX fg_certificado_gnv_verificacion_pkey ON public.fg_certificado_gnv_verificacion USING btree (id);
  ```
- **fg_certificado_gnv_verificacion_certificado_id_codigo_key**: 
  ```sql
  CREATE UNIQUE INDEX fg_certificado_gnv_verificacion_certificado_id_codigo_key ON public.fg_certificado_gnv_verificacion USING btree (certificado_id, codigo);
  ```
- **fg_certificado_gnv_verificacion_certificado_id_orden_key**: 
  ```sql
  CREATE UNIQUE INDEX fg_certificado_gnv_verificacion_certificado_id_orden_key ON public.fg_certificado_gnv_verificacion USING btree (certificado_id, orden);
  ```

**Script CREATE TABLE REAL:**
```sql
CREATE TABLE fg_certificado_gnv_verificacion (
  id bigint NOT NULL DEFAULT nextval('fg_certificado_gnv_verificacion_id_seq'::regclass),
  certificado_id bigint NOT NULL,
  codigo character varying(5) NOT NULL,
  orden smallint NOT NULL,
  descripcion text NOT NULL,
  cumple boolean NOT NULL,
  observacion text,
  CONSTRAINT fg_certificado_gnv_verificacion_pkey PRIMARY KEY (id)
);
```

### fg_certificado_glp

**Objetivo funcional**: Almacena información sobre fg_certificado_glp.

**Tabla de Columnas:**
| COLUMNA | TIPO | LONGITUD/PRECISIÓN | NULL | DEFAULT | PK/FK |
| --- | --- | --- | --- | --- | --- |
| certificado_id | bigint | 64 | NOT NULL | - | PK/FK |
| taller_autorizado_id | bigint | 64 | NULL | - | FK |
| expediente_tecnico | character varying | 100 | NULL | - |  |
| vigencia_hasta | date | - | NULL | - |  |
| taller_razon_social | character varying | 300 | NULL | - |  |
| taller_sede | character varying | 200 | NULL | - |  |
| taller_direccion | character varying | 500 | NULL | - |  |
| taller_codigo_autorizacion | character varying | 100 | NULL | - |  |

**PRIMARY KEY:**
- fg_certificado_glp_pkey (certificado_id)

**FOREIGN KEYS:**
- **fk_cert_glp_cert**: (certificado_id) -> fg_certificado (id). ON UPDATE CASCADE ON DELETE CASCADE
- **fk_cert_glp_taller**: (taller_autorizado_id) -> fg_taller_autorizado (id). ON UPDATE CASCADE ON DELETE NO ACTION

**UNIQUE:**
- Ninguna

**CHECK:**
- **2200_172272_1_not_null**: certificado_id IS NOT NULL

**Índices:**
- **fg_certificado_glp_pkey**: 
  ```sql
  CREATE UNIQUE INDEX fg_certificado_glp_pkey ON public.fg_certificado_glp USING btree (certificado_id);
  ```

**Script CREATE TABLE REAL:**
```sql
CREATE TABLE fg_certificado_glp (
  certificado_id bigint NOT NULL,
  taller_autorizado_id bigint,
  expediente_tecnico character varying(100),
  vigencia_hasta date,
  taller_razon_social character varying(300),
  taller_sede character varying(200),
  taller_direccion character varying(500),
  taller_codigo_autorizacion character varying(100),
  CONSTRAINT fg_certificado_glp_pkey PRIMARY KEY (certificado_id)
);
```

### fg_certificado_glp_componente

**Objetivo funcional**: Almacena información sobre fg_certificado_glp_componente.

**Tabla de Columnas:**
| COLUMNA | TIPO | LONGITUD/PRECISIÓN | NULL | DEFAULT | PK/FK |
| --- | --- | --- | --- | --- | --- |
| id | bigint | 64 | NOT NULL | nextval('fg_certificado_glp_componente_id_seq'::regclass) | PK |
| certificado_id | bigint | 64 | NOT NULL | - | FK |
| orden | smallint | 16 | NOT NULL | - |  |
| componente | character varying | 100 | NOT NULL | - |  |
| marca | character varying | 150 | NULL | - |  |
| modelo | character varying | 150 | NULL | - |  |
| capacidad_litros | numeric | 10 | NULL | - |  |
| mes_fabricacion | smallint | 16 | NULL | - |  |
| anio_fabricacion | smallint | 16 | NULL | - |  |
| numero_serie | character varying | 200 | NULL | - |  |

**PRIMARY KEY:**
- fg_certificado_glp_componente_pkey (id)

**FOREIGN KEYS:**
- **fk_cert_glp_comp_cert**: (certificado_id) -> fg_certificado_glp (certificado_id). ON UPDATE CASCADE ON DELETE CASCADE

**UNIQUE:**
- **fg_certificado_glp_componente_certificado_id_orden_key**: (certificado_id, certificado_id, orden, orden)

**CHECK:**
- **fg_certificado_glp_componente_mes_fabricacion_check**: (((mes_fabricacion IS NULL) OR ((mes_fabricacion >= 1) AND (mes_fabricacion <= 12))))
- **2200_172292_1_not_null**: id IS NOT NULL
- **2200_172292_2_not_null**: certificado_id IS NOT NULL
- **2200_172292_3_not_null**: orden IS NOT NULL
- **2200_172292_4_not_null**: componente IS NOT NULL

**Índices:**
- **fg_certificado_glp_componente_pkey**: 
  ```sql
  CREATE UNIQUE INDEX fg_certificado_glp_componente_pkey ON public.fg_certificado_glp_componente USING btree (id);
  ```
- **fg_certificado_glp_componente_certificado_id_orden_key**: 
  ```sql
  CREATE UNIQUE INDEX fg_certificado_glp_componente_certificado_id_orden_key ON public.fg_certificado_glp_componente USING btree (certificado_id, orden);
  ```

**Script CREATE TABLE REAL:**
```sql
CREATE TABLE fg_certificado_glp_componente (
  id bigint NOT NULL DEFAULT nextval('fg_certificado_glp_componente_id_seq'::regclass),
  certificado_id bigint NOT NULL,
  orden smallint NOT NULL,
  componente character varying(100) NOT NULL,
  marca character varying(150),
  modelo character varying(150),
  capacidad_litros numeric,
  mes_fabricacion smallint,
  anio_fabricacion smallint,
  numero_serie character varying(200),
  CONSTRAINT fg_certificado_glp_componente_pkey PRIMARY KEY (id)
);
```

### fg_certificado_glp_verificacion

**Objetivo funcional**: Almacena información sobre fg_certificado_glp_verificacion.

**Tabla de Columnas:**
| COLUMNA | TIPO | LONGITUD/PRECISIÓN | NULL | DEFAULT | PK/FK |
| --- | --- | --- | --- | --- | --- |
| id | bigint | 64 | NOT NULL | nextval('fg_certificado_glp_verificacion_id_seq'::regclass) | PK |
| certificado_id | bigint | 64 | NOT NULL | - | FK |
| codigo | character varying | 5 | NOT NULL | - |  |
| orden | smallint | 16 | NOT NULL | - |  |
| descripcion | text | - | NOT NULL | - |  |
| cumple | boolean | - | NOT NULL | - |  |
| observacion | text | - | NULL | - |  |

**PRIMARY KEY:**
- fg_certificado_glp_verificacion_pkey (id)

**FOREIGN KEYS:**
- **fk_cert_glp_verif_cert**: (certificado_id) -> fg_certificado_glp (certificado_id). ON UPDATE CASCADE ON DELETE CASCADE

**UNIQUE:**
- **fg_certificado_glp_verificacion_certificado_id_codigo_key**: (certificado_id, certificado_id, codigo, codigo)
- **fg_certificado_glp_verificacion_certificado_id_orden_key**: (certificado_id, certificado_id, orden, orden)

**CHECK:**
- **2200_172312_1_not_null**: id IS NOT NULL
- **2200_172312_2_not_null**: certificado_id IS NOT NULL
- **2200_172312_3_not_null**: codigo IS NOT NULL
- **2200_172312_4_not_null**: orden IS NOT NULL
- **2200_172312_5_not_null**: descripcion IS NOT NULL
- **2200_172312_6_not_null**: cumple IS NOT NULL

**Índices:**
- **fg_certificado_glp_verificacion_pkey**: 
  ```sql
  CREATE UNIQUE INDEX fg_certificado_glp_verificacion_pkey ON public.fg_certificado_glp_verificacion USING btree (id);
  ```
- **fg_certificado_glp_verificacion_certificado_id_codigo_key**: 
  ```sql
  CREATE UNIQUE INDEX fg_certificado_glp_verificacion_certificado_id_codigo_key ON public.fg_certificado_glp_verificacion USING btree (certificado_id, codigo);
  ```
- **fg_certificado_glp_verificacion_certificado_id_orden_key**: 
  ```sql
  CREATE UNIQUE INDEX fg_certificado_glp_verificacion_certificado_id_orden_key ON public.fg_certificado_glp_verificacion USING btree (certificado_id, orden);
  ```

**Script CREATE TABLE REAL:**
```sql
CREATE TABLE fg_certificado_glp_verificacion (
  id bigint NOT NULL DEFAULT nextval('fg_certificado_glp_verificacion_id_seq'::regclass),
  certificado_id bigint NOT NULL,
  codigo character varying(5) NOT NULL,
  orden smallint NOT NULL,
  descripcion text NOT NULL,
  cumple boolean NOT NULL,
  observacion text,
  CONSTRAINT fg_certificado_glp_verificacion_pkey PRIMARY KEY (id)
);
```

### fg_certificado_conformidad

**Objetivo funcional**: Almacena información sobre fg_certificado_conformidad.

**Tabla de Columnas:**
| COLUMNA | TIPO | LONGITUD/PRECISIÓN | NULL | DEFAULT | PK/FK |
| --- | --- | --- | --- | --- | --- |
| certificado_id | bigint | 64 | NOT NULL | - | PK/FK |
| tipo_conformidad | character varying | 30 | NOT NULL | - |  |
| tipo_tramite | character varying | 200 | NULL | - |  |
| caracteristica_registrable | character varying | 300 | NULL | - |  |
| motivo | text | - | NULL | - |  |
| descripcion | text | - | NULL | - |  |
| uso_original_vehiculo | character varying | 200 | NULL | - |  |

**PRIMARY KEY:**
- fg_certificado_conformidad_pkey (certificado_id)

**FOREIGN KEYS:**
- **fk_cert_conf_cert**: (certificado_id) -> fg_certificado (id). ON UPDATE CASCADE ON DELETE CASCADE

**UNIQUE:**
- Ninguna

**CHECK:**
- **2200_172331_1_not_null**: certificado_id IS NOT NULL
- **2200_172331_2_not_null**: tipo_conformidad IS NOT NULL

**Índices:**
- **fg_certificado_conformidad_pkey**: 
  ```sql
  CREATE UNIQUE INDEX fg_certificado_conformidad_pkey ON public.fg_certificado_conformidad USING btree (certificado_id);
  ```

**Script CREATE TABLE REAL:**
```sql
CREATE TABLE fg_certificado_conformidad (
  certificado_id bigint NOT NULL,
  tipo_conformidad character varying(30) NOT NULL,
  tipo_tramite character varying(200),
  caracteristica_registrable character varying(300),
  motivo text,
  descripcion text,
  uso_original_vehiculo character varying(200),
  CONSTRAINT fg_certificado_conformidad_pkey PRIMARY KEY (certificado_id)
);
```

## RELACIONES OPERATIVAS

```text
fg_cliente
   |
   +--> fg_certificado
             |
             +--> fg_certificado_vehiculo
             |
             +--> fg_certificado_titular
             |
             +--> fg_certificado_gnv
             |       |
             |       +--> fg_certificado_gnv_verificacion
             |
             +--> fg_certificado_glp
             |       |
             |       +--> fg_certificado_glp_componente
             |       |
             |       +--> fg_certificado_glp_verificacion
             |
             +--> fg_certificado_conformidad

fg_planta
   |
   +--> fg_correlativo_certificado

fg_tipo_certificado
   |
   +--> fg_correlativo_certificado
   |
   +--> fg_certificado

fg_taller_autorizado
   |
   +--> fg_certificado_gnv
   |
   +--> fg_certificado_glp
```

## DEPENDENCIAS POSTGRESQL

La base de datos requiere la extensión `btree_gist` instalada para la constraint de exclusión de rangos de fg_correlativo_certificado.

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;
```

## DATOS ACTUALES

Para tablas de catálogos y configuración. Para *fg_correlativo_certificado*: Sin rangos configurados actualmente.

## ANEXO A - SCRIPT COMPLETO DE INSTALACIÓN FAREGAS

El script crea 22 tablas en el orden correcto de dependencias y sin datos conflictivos, ideal para despliegues de producción.

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE fg_planta (
  key character varying(20) NOT NULL,
  nombre character varying(150) NOT NULL,
  direccion character varying(500),
  telefono character varying(255),
  CONSTRAINT fg_planta_pkey PRIMARY KEY (key),
  CONSTRAINT 2200_172004_1_not_null CHECK (key IS NOT NULL),
  CONSTRAINT 2200_172004_2_not_null CHECK (nombre IS NOT NULL)
);

CREATE UNIQUE INDEX fg_planta_pkey ON public.fg_planta USING btree (key);

CREATE TABLE fg_taller_autorizado (
  id bigint NOT NULL DEFAULT nextval('fg_taller_autorizado_id_seq'::regclass),
  ruc character varying(11),
  razon_social character varying(300) NOT NULL,
  nombre_comercial character varying(300),
  sede character varying(200),
  direccion character varying(500),
  codigo_autorizacion character varying(100),
  estado boolean NOT NULL DEFAULT true,
  fecha_creacion timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  fecha_modificacion timestamp without time zone,
  CONSTRAINT fg_taller_autorizado_pkey PRIMARY KEY (id),
  CONSTRAINT 2200_172222_1_not_null CHECK (id IS NOT NULL),
  CONSTRAINT 2200_172222_3_not_null CHECK (razon_social IS NOT NULL),
  CONSTRAINT 2200_172222_8_not_null CHECK (estado IS NOT NULL),
  CONSTRAINT 2200_172222_9_not_null CHECK (fecha_creacion IS NOT NULL)
);

CREATE UNIQUE INDEX fg_taller_autorizado_pkey ON public.fg_taller_autorizado USING btree (id);

CREATE TABLE fg_cliente (
  id bigint NOT NULL DEFAULT nextval('fg_cliente_id_seq'::regclass),
  tipo_documento character varying(10) NOT NULL,
  nro_documento character varying(20) NOT NULL,
  nombre_razon_social character varying(300) NOT NULL,
  direccion character varying(500),
  telefono character varying(30),
  correo character varying(200),
  estado boolean NOT NULL DEFAULT true,
  fecha_creacion timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  fecha_modificacion timestamp without time zone,
  CONSTRAINT fg_cliente_pkey PRIMARY KEY (id),
  CONSTRAINT fg_cliente_tipo_documento_nro_documento_key UNIQUE (tipo_documento, nro_documento),
  CONSTRAINT 2200_172097_1_not_null CHECK (id IS NOT NULL),
  CONSTRAINT 2200_172097_2_not_null CHECK (tipo_documento IS NOT NULL),
  CONSTRAINT 2200_172097_3_not_null CHECK (nro_documento IS NOT NULL),
  CONSTRAINT 2200_172097_4_not_null CHECK (nombre_razon_social IS NOT NULL),
  CONSTRAINT 2200_172097_8_not_null CHECK (estado IS NOT NULL),
  CONSTRAINT 2200_172097_9_not_null CHECK (fecha_creacion IS NOT NULL)
);

CREATE UNIQUE INDEX fg_cliente_pkey ON public.fg_cliente USING btree (id);

CREATE UNIQUE INDEX fg_cliente_tipo_documento_nro_documento_key ON public.fg_cliente USING btree (tipo_documento, nro_documento);

CREATE TABLE fg_tipo_certificado (
  clave character varying(30) NOT NULL,
  nombre character varying(100) NOT NULL,
  descripcion character varying(300),
  activo boolean NOT NULL DEFAULT true,
  entidad_certificadora_nombre character varying(300),
  resolucion_directoral character varying(150),
  domicilio_fiscal character varying(500),
  telefono character varying(30),
  lugar_emision character varying(150),
  codigo character varying(2) NOT NULL,
  CONSTRAINT fg_tipo_certificado_pkey PRIMARY KEY (clave),
  CONSTRAINT fg_tipo_certificado_codigo_key UNIQUE (codigo),
  CONSTRAINT 2200_172110_1_not_null CHECK (clave IS NOT NULL),
  CONSTRAINT 2200_172110_2_not_null CHECK (nombre IS NOT NULL),
  CONSTRAINT 2200_172110_4_not_null CHECK (activo IS NOT NULL),
  CONSTRAINT 2200_172110_10_not_null CHECK (codigo IS NOT NULL)
);

CREATE UNIQUE INDEX fg_tipo_certificado_pkey ON public.fg_tipo_certificado USING btree (clave);

CREATE UNIQUE INDEX fg_tipo_certificado_codigo_key ON public.fg_tipo_certificado USING btree (codigo);

CREATE TABLE fg_perfil (
  clave character varying(255) NOT NULL,
  nombre character varying(255) NOT NULL,
  visible boolean,
  CONSTRAINT fg_perfil_pkey PRIMARY KEY (clave),
  CONSTRAINT 2200_171956_1_not_null CHECK (clave IS NOT NULL),
  CONSTRAINT 2200_171956_2_not_null CHECK (nombre IS NOT NULL)
);

CREATE UNIQUE INDEX fg_perfil_pkey ON public.fg_perfil USING btree (clave);

CREATE TABLE fg_permiso (
  clave character varying(100) NOT NULL,
  nombre character varying(200) NOT NULL,
  modulo character varying(100) NOT NULL,
  descripcion text,
  activo boolean NOT NULL DEFAULT true,
  CONSTRAINT fg_permiso_pkey PRIMARY KEY (clave),
  CONSTRAINT 2200_171964_1_not_null CHECK (clave IS NOT NULL),
  CONSTRAINT 2200_171964_2_not_null CHECK (nombre IS NOT NULL),
  CONSTRAINT 2200_171964_3_not_null CHECK (modulo IS NOT NULL),
  CONSTRAINT 2200_171964_5_not_null CHECK (activo IS NOT NULL)
);

CREATE UNIQUE INDEX fg_permiso_pkey ON public.fg_permiso USING btree (clave);

CREATE TABLE fg_perfil_permiso (
  perfil_clave character varying(255) NOT NULL,
  permiso_clave character varying(100) NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT pk_fg_perfil_permiso PRIMARY KEY (perfil_clave, permiso_clave),
  CONSTRAINT fk_fg_pp_perfil FOREIGN KEY (perfil_clave) REFERENCES fg_perfil (clave) ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT fk_fg_pp_permiso FOREIGN KEY (permiso_clave) REFERENCES fg_permiso (clave) ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT 2200_171973_1_not_null CHECK (perfil_clave IS NOT NULL),
  CONSTRAINT 2200_171973_2_not_null CHECK (permiso_clave IS NOT NULL),
  CONSTRAINT 2200_171973_3_not_null CHECK (created_at IS NOT NULL)
);

CREATE UNIQUE INDEX pk_fg_perfil_permiso ON public.fg_perfil_permiso USING btree (perfil_clave, permiso_clave);

CREATE INDEX idx_fg_perfil_permiso_perfil ON public.fg_perfil_permiso USING btree (perfil_clave);

CREATE INDEX idx_fg_perfil_permiso_permiso ON public.fg_perfil_permiso USING btree (permiso_clave);

CREATE TABLE fg_perfil_planta (
  perfil_clave character varying(255) NOT NULL,
  planta_key character varying(20) NOT NULL,
  CONSTRAINT fg_perfil_planta_pkey PRIMARY KEY (perfil_clave, planta_key),
  CONSTRAINT fg_perfil_planta_perfil_clave_fkey FOREIGN KEY (perfil_clave) REFERENCES fg_perfil (clave) ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT fg_perfil_planta_planta_key_fkey FOREIGN KEY (planta_key) REFERENCES fg_planta (key) ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT 2200_172065_1_not_null CHECK (perfil_clave IS NOT NULL),
  CONSTRAINT 2200_172065_2_not_null CHECK (planta_key IS NOT NULL)
);

CREATE UNIQUE INDEX fg_perfil_planta_pkey ON public.fg_perfil_planta USING btree (perfil_clave, planta_key);

CREATE TABLE fg_usuario (
  username character varying(255) NOT NULL,
  user_type character varying(31) NOT NULL,
  contrasenha character varying(255) NOT NULL,
  perfil_id character varying(255),
  persona_nrodocumentoidentidad character varying(20),
  estado boolean,
  foto text,
  CONSTRAINT fg_usuario_pkey PRIMARY KEY (username),
  CONSTRAINT fk_fg_usuario_perfil FOREIGN KEY (perfil_id) REFERENCES fg_perfil (clave) ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT 2200_171991_1_not_null CHECK (username IS NOT NULL),
  CONSTRAINT 2200_171991_2_not_null CHECK (user_type IS NOT NULL),
  CONSTRAINT 2200_171991_3_not_null CHECK (contrasenha IS NOT NULL)
);

CREATE UNIQUE INDEX fg_usuario_pkey ON public.fg_usuario USING btree (username);

CREATE TABLE fg_usuario_planta (
  usuario_username character varying(255) NOT NULL,
  plantas_key character varying(20) NOT NULL,
  CONSTRAINT pk_fg_usuario_planta PRIMARY KEY (usuario_username, plantas_key),
  CONSTRAINT fk_fg_up_planta FOREIGN KEY (plantas_key) REFERENCES fg_planta (key) ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT fk_fg_up_usuario FOREIGN KEY (usuario_username) REFERENCES fg_usuario (username) ON UPDATE CASCADE ON DELETE NO ACTION,
  CONSTRAINT 2200_172012_1_not_null CHECK (usuario_username IS NOT NULL),
  CONSTRAINT 2200_172012_2_not_null CHECK (plantas_key IS NOT NULL)
);

CREATE UNIQUE INDEX pk_fg_usuario_planta ON public.fg_usuario_planta USING btree (usuario_username, plantas_key);

CREATE TABLE fg_usuario_sesion (
  id bigint NOT NULL DEFAULT nextval('fg_usuario_sesion_id_seq'::regclass),
  usuario_username character varying(255) NOT NULL,
  logintime_utc timestamp without time zone NOT NULL DEFAULT timezone('UTC'::text, now()),
  isactive boolean NOT NULL DEFAULT true,
  server_name character varying(100),
  clienteip character varying(45),
  logouttime_utc timestamp without time zone,
  session_jti uuid NOT NULL,
  revoked_at_utc timestamp without time zone,
  jwt_jti uuid,
  access_expires_utc timestamp without time zone,
  refresh_token_hash text,
  refresh_expires_utc timestamp without time zone,
  planta_key character varying(20),
  CONSTRAINT fg_usuario_sesion_pkey PRIMARY KEY (id),
  CONSTRAINT fk_fg_us_planta FOREIGN KEY (planta_key) REFERENCES fg_planta (key) ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT fk_fg_us_usuario FOREIGN KEY (usuario_username) REFERENCES fg_usuario (username) ON UPDATE CASCADE ON DELETE NO ACTION,
  CONSTRAINT fg_usuario_sesion_session_jti_key UNIQUE (session_jti),
  CONSTRAINT 2200_172029_1_not_null CHECK (id IS NOT NULL),
  CONSTRAINT 2200_172029_2_not_null CHECK (usuario_username IS NOT NULL),
  CONSTRAINT 2200_172029_3_not_null CHECK (logintime_utc IS NOT NULL),
  CONSTRAINT 2200_172029_4_not_null CHECK (isactive IS NOT NULL),
  CONSTRAINT 2200_172029_8_not_null CHECK (session_jti IS NOT NULL)
);

CREATE UNIQUE INDEX fg_usuario_sesion_pkey ON public.fg_usuario_sesion USING btree (id);

CREATE UNIQUE INDEX fg_usuario_sesion_session_jti_key ON public.fg_usuario_sesion USING btree (session_jti);

CREATE INDEX idx_fg_usuario_sesion_user_active ON public.fg_usuario_sesion USING btree (usuario_username, isactive);

CREATE INDEX ix_fg_usuario_sesion_planta_key ON public.fg_usuario_sesion USING btree (planta_key) WHERE (planta_key IS NOT NULL);

CREATE TABLE fg_auditoria_acceso (
  id bigint NOT NULL DEFAULT nextval('fg_auditoria_acceso_id_seq'::regclass),
  username character varying(255),
  evento character varying(50) NOT NULL,
  exitoso boolean NOT NULL,
  mensaje text,
  planta_key character varying(20),
  ip_direccion character varying(45),
  user_agent character varying(1000),
  fecha_evento timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fg_auditoria_acceso_pkey PRIMARY KEY (id),
  CONSTRAINT 2200_172082_1_not_null CHECK (id IS NOT NULL),
  CONSTRAINT 2200_172082_3_not_null CHECK (evento IS NOT NULL),
  CONSTRAINT 2200_172082_4_not_null CHECK (exitoso IS NOT NULL),
  CONSTRAINT 2200_172082_9_not_null CHECK (fecha_evento IS NOT NULL)
);

CREATE UNIQUE INDEX fg_auditoria_acceso_pkey ON public.fg_auditoria_acceso USING btree (id);

CREATE INDEX idx_fg_auditoria_acceso_fecha_evento ON public.fg_auditoria_acceso USING btree (fecha_evento);

CREATE INDEX idx_fg_auditoria_acceso_username ON public.fg_auditoria_acceso USING btree (username);

CREATE INDEX idx_fg_auditoria_acceso_evento ON public.fg_auditoria_acceso USING btree (evento);

CREATE TABLE fg_correlativo_certificado (
  id bigint NOT NULL DEFAULT nextval('fg_correlativo_certificado_id_seq'::regclass),
  tipo_certificado_clave character varying(30) NOT NULL,
  nro_actual bigint NOT NULL DEFAULT 0,
  activo boolean NOT NULL DEFAULT true,
  fecha_modificacion timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  planta_key character varying(20) NOT NULL,
  nro_inicio bigint NOT NULL,
  nro_maximo bigint NOT NULL,
  fecha_asignacion timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  fecha_cierre timestamp without time zone,
  CONSTRAINT fg_correlativo_certificado_pkey PRIMARY KEY (id),
  CONSTRAINT fk_correlativo_tipo FOREIGN KEY (tipo_certificado_clave) REFERENCES fg_tipo_certificado (clave) ON UPDATE CASCADE ON DELETE NO ACTION,
  CONSTRAINT fk_correlativo_planta FOREIGN KEY (planta_key) REFERENCES fg_planta (key) ON UPDATE CASCADE ON DELETE NO ACTION,
  CONSTRAINT fg_correlativo_certificado_hist_key UNIQUE (planta_key, tipo_certificado_clave, nro_inicio, nro_maximo),
  CONSTRAINT chk_cierre CHECK ((((activo = false) OR (fecha_cierre IS NULL)))),
  CONSTRAINT chk_nro_inicio CHECK (((nro_inicio > 0))),
  CONSTRAINT chk_nro_maximo CHECK (((nro_maximo >= nro_inicio))),
  CONSTRAINT chk_nro_actual_min CHECK (((nro_actual >= (nro_inicio - 1)))),
  CONSTRAINT chk_nro_actual_max CHECK (((nro_actual <= nro_maximo))),
  CONSTRAINT 2200_172121_1_not_null CHECK (id IS NOT NULL),
  CONSTRAINT 2200_172121_2_not_null CHECK (tipo_certificado_clave IS NOT NULL),
  CONSTRAINT 2200_172121_4_not_null CHECK (nro_actual IS NOT NULL),
  CONSTRAINT 2200_172121_5_not_null CHECK (activo IS NOT NULL),
  CONSTRAINT 2200_172121_6_not_null CHECK (fecha_modificacion IS NOT NULL),
  CONSTRAINT 2200_172121_7_not_null CHECK (planta_key IS NOT NULL),
  CONSTRAINT 2200_172121_8_not_null CHECK (nro_inicio IS NOT NULL),
  CONSTRAINT 2200_172121_9_not_null CHECK (nro_maximo IS NOT NULL),
  CONSTRAINT 2200_172121_10_not_null CHECK (fecha_asignacion IS NOT NULL)
);

CREATE UNIQUE INDEX fg_correlativo_certificado_pkey ON public.fg_correlativo_certificado USING btree (id);

CREATE UNIQUE INDEX fg_correlativo_certificado_hist_key ON public.fg_correlativo_certificado USING btree (planta_key, tipo_certificado_clave, nro_inicio, nro_maximo);

CREATE UNIQUE INDEX fg_correlativo_certificado_activo_idx ON public.fg_correlativo_certificado USING btree (planta_key, tipo_certificado_clave) WHERE (activo = true);

CREATE INDEX excl_fg_correlativo_rango ON public.fg_correlativo_certificado USING gist (planta_key, tipo_certificado_clave, int8range(nro_inicio, nro_maximo, '[]'::text));

CREATE TABLE fg_certificado (
  id bigint NOT NULL DEFAULT nextval('fg_certificado_id_seq'::regclass),
  tipo_certificado_clave character varying(30) NOT NULL,
  numero_certificado character varying(50),
  cliente_id bigint,
  planta_key character varying(20) NOT NULL,
  fecha_emision date,
  estado character varying(30),
  observaciones text,
  usuario_creacion character varying(255) NOT NULL,
  fecha_creacion timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  usuario_modificacion character varying(255),
  fecha_modificacion timestamp without time zone,
  entidad_certificadora_nombre character varying(300),
  resolucion_directoral character varying(150),
  domicilio_fiscal character varying(500),
  telefono_certificadora character varying(30),
  lugar_emision character varying(150),
  CONSTRAINT fg_certificado_pkey PRIMARY KEY (id),
  CONSTRAINT fk_certificado_tipo FOREIGN KEY (tipo_certificado_clave) REFERENCES fg_tipo_certificado (clave) ON UPDATE CASCADE ON DELETE NO ACTION,
  CONSTRAINT fk_certificado_cliente FOREIGN KEY (cliente_id) REFERENCES fg_cliente (id) ON UPDATE CASCADE ON DELETE NO ACTION,
  CONSTRAINT fk_certificado_planta FOREIGN KEY (planta_key) REFERENCES fg_planta (key) ON UPDATE CASCADE ON DELETE NO ACTION,
  CONSTRAINT fk_certificado_usuarioc FOREIGN KEY (usuario_creacion) REFERENCES fg_usuario (username) ON UPDATE CASCADE ON DELETE NO ACTION,
  CONSTRAINT fk_certificado_usuariom FOREIGN KEY (usuario_modificacion) REFERENCES fg_usuario (username) ON UPDATE CASCADE ON DELETE NO ACTION,
  CONSTRAINT fg_certificado_numero_certificado_key UNIQUE (numero_certificado),
  CONSTRAINT 2200_172139_1_not_null CHECK (id IS NOT NULL),
  CONSTRAINT 2200_172139_2_not_null CHECK (tipo_certificado_clave IS NOT NULL),
  CONSTRAINT 2200_172139_5_not_null CHECK (planta_key IS NOT NULL),
  CONSTRAINT 2200_172139_9_not_null CHECK (usuario_creacion IS NOT NULL),
  CONSTRAINT 2200_172139_10_not_null CHECK (fecha_creacion IS NOT NULL)
);

CREATE UNIQUE INDEX fg_certificado_pkey ON public.fg_certificado USING btree (id);

CREATE UNIQUE INDEX fg_certificado_numero_certificado_key ON public.fg_certificado USING btree (numero_certificado);

CREATE INDEX idx_fg_certificado_tipo ON public.fg_certificado USING btree (tipo_certificado_clave);

CREATE INDEX idx_fg_certificado_cli ON public.fg_certificado USING btree (cliente_id);

CREATE INDEX idx_fg_certificado_planta ON public.fg_certificado USING btree (planta_key);

CREATE INDEX idx_fg_certificado_fecha ON public.fg_certificado USING btree (fecha_emision);

CREATE INDEX idx_fg_certificado_estado ON public.fg_certificado USING btree (estado);

CREATE TABLE fg_certificado_vehiculo (
  certificado_id bigint NOT NULL,
  placa character varying(255),
  categoria character varying(255),
  clase character varying(255),
  marca character varying(255),
  modelo character varying(255),
  version character varying(255),
  anio_fabricacion character varying(10),
  anio_modelo character varying(10),
  vin character varying(255),
  serie_chasis character varying(255),
  numero_motor character varying(255),
  combustible character varying(255),
  color character varying(255),
  carroceria character varying(255),
  numero_cilindros integer,
  cilindrada numeric,
  numero_ejes integer,
  numero_ruedas integer,
  numero_asientos integer,
  numero_pasajeros integer,
  longitud numeric,
  ancho numeric,
  alto numeric,
  peso_neto numeric,
  peso_bruto numeric,
  carga_util numeric,
  potencia character varying(100),
  formula_rodante character varying(50),
  CONSTRAINT fg_certificado_vehiculo_pkey PRIMARY KEY (certificado_id),
  CONSTRAINT fk_cert_vehiculo_cert FOREIGN KEY (certificado_id) REFERENCES fg_certificado (id) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT 2200_172182_1_not_null CHECK (certificado_id IS NOT NULL)
);

CREATE UNIQUE INDEX fg_certificado_vehiculo_pkey ON public.fg_certificado_vehiculo USING btree (certificado_id);

CREATE TABLE fg_certificado_titular (
  id bigint NOT NULL DEFAULT nextval('fg_certificado_titular_id_seq'::regclass),
  certificado_id bigint NOT NULL,
  cliente_id bigint,
  orden smallint NOT NULL,
  tipo_documento character varying(10),
  nro_documento character varying(20),
  nombre_razon_social character varying(300) NOT NULL,
  direccion character varying(500),
  CONSTRAINT fg_certificado_titular_pkey PRIMARY KEY (id),
  CONSTRAINT fk_cert_titular_cert FOREIGN KEY (certificado_id) REFERENCES fg_certificado (id) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_cert_titular_cliente FOREIGN KEY (cliente_id) REFERENCES fg_cliente (id) ON UPDATE CASCADE ON DELETE NO ACTION,
  CONSTRAINT fg_certificado_titular_certificado_id_orden_key UNIQUE (certificado_id, orden),
  CONSTRAINT 2200_172197_1_not_null CHECK (id IS NOT NULL),
  CONSTRAINT 2200_172197_2_not_null CHECK (certificado_id IS NOT NULL),
  CONSTRAINT 2200_172197_4_not_null CHECK (orden IS NOT NULL),
  CONSTRAINT 2200_172197_7_not_null CHECK (nombre_razon_social IS NOT NULL)
);

CREATE UNIQUE INDEX fg_certificado_titular_pkey ON public.fg_certificado_titular USING btree (id);

CREATE UNIQUE INDEX fg_certificado_titular_certificado_id_orden_key ON public.fg_certificado_titular USING btree (certificado_id, orden);

CREATE INDEX idx_fg_cert_titular_cli ON public.fg_certificado_titular USING btree (cliente_id);

CREATE TABLE fg_certificado_gnv (
  certificado_id bigint NOT NULL,
  taller_autorizado_id bigint,
  vigencia_hasta date,
  taller_razon_social character varying(300),
  taller_sede character varying(200),
  taller_direccion character varying(500),
  taller_codigo_autorizacion character varying(100),
  CONSTRAINT fg_certificado_gnv_pkey PRIMARY KEY (certificado_id),
  CONSTRAINT fk_cert_gnv_cert FOREIGN KEY (certificado_id) REFERENCES fg_certificado (id) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_cert_gnv_taller FOREIGN KEY (taller_autorizado_id) REFERENCES fg_taller_autorizado (id) ON UPDATE CASCADE ON DELETE NO ACTION,
  CONSTRAINT 2200_172233_1_not_null CHECK (certificado_id IS NOT NULL)
);

CREATE UNIQUE INDEX fg_certificado_gnv_pkey ON public.fg_certificado_gnv USING btree (certificado_id);

CREATE TABLE fg_certificado_gnv_verificacion (
  id bigint NOT NULL DEFAULT nextval('fg_certificado_gnv_verificacion_id_seq'::regclass),
  certificado_id bigint NOT NULL,
  codigo character varying(5) NOT NULL,
  orden smallint NOT NULL,
  descripcion text NOT NULL,
  cumple boolean NOT NULL,
  observacion text,
  CONSTRAINT fg_certificado_gnv_verificacion_pkey PRIMARY KEY (id),
  CONSTRAINT fk_cert_gnv_verif_cert FOREIGN KEY (certificado_id) REFERENCES fg_certificado_gnv (certificado_id) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fg_certificado_gnv_verificacion_certificado_id_codigo_key UNIQUE (certificado_id, codigo),
  CONSTRAINT fg_certificado_gnv_verificacion_certificado_id_orden_key UNIQUE (certificado_id, orden),
  CONSTRAINT 2200_172253_1_not_null CHECK (id IS NOT NULL),
  CONSTRAINT 2200_172253_2_not_null CHECK (certificado_id IS NOT NULL),
  CONSTRAINT 2200_172253_3_not_null CHECK (codigo IS NOT NULL),
  CONSTRAINT 2200_172253_4_not_null CHECK (orden IS NOT NULL),
  CONSTRAINT 2200_172253_5_not_null CHECK (descripcion IS NOT NULL),
  CONSTRAINT 2200_172253_6_not_null CHECK (cumple IS NOT NULL)
);

CREATE UNIQUE INDEX fg_certificado_gnv_verificacion_pkey ON public.fg_certificado_gnv_verificacion USING btree (id);

CREATE UNIQUE INDEX fg_certificado_gnv_verificacion_certificado_id_codigo_key ON public.fg_certificado_gnv_verificacion USING btree (certificado_id, codigo);

CREATE UNIQUE INDEX fg_certificado_gnv_verificacion_certificado_id_orden_key ON public.fg_certificado_gnv_verificacion USING btree (certificado_id, orden);

CREATE TABLE fg_certificado_glp (
  certificado_id bigint NOT NULL,
  taller_autorizado_id bigint,
  expediente_tecnico character varying(100),
  vigencia_hasta date,
  taller_razon_social character varying(300),
  taller_sede character varying(200),
  taller_direccion character varying(500),
  taller_codigo_autorizacion character varying(100),
  CONSTRAINT fg_certificado_glp_pkey PRIMARY KEY (certificado_id),
  CONSTRAINT fk_cert_glp_cert FOREIGN KEY (certificado_id) REFERENCES fg_certificado (id) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_cert_glp_taller FOREIGN KEY (taller_autorizado_id) REFERENCES fg_taller_autorizado (id) ON UPDATE CASCADE ON DELETE NO ACTION,
  CONSTRAINT 2200_172272_1_not_null CHECK (certificado_id IS NOT NULL)
);

CREATE UNIQUE INDEX fg_certificado_glp_pkey ON public.fg_certificado_glp USING btree (certificado_id);

CREATE TABLE fg_certificado_glp_componente (
  id bigint NOT NULL DEFAULT nextval('fg_certificado_glp_componente_id_seq'::regclass),
  certificado_id bigint NOT NULL,
  orden smallint NOT NULL,
  componente character varying(100) NOT NULL,
  marca character varying(150),
  modelo character varying(150),
  capacidad_litros numeric,
  mes_fabricacion smallint,
  anio_fabricacion smallint,
  numero_serie character varying(200),
  CONSTRAINT fg_certificado_glp_componente_pkey PRIMARY KEY (id),
  CONSTRAINT fk_cert_glp_comp_cert FOREIGN KEY (certificado_id) REFERENCES fg_certificado_glp (certificado_id) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fg_certificado_glp_componente_certificado_id_orden_key UNIQUE (certificado_id, orden),
  CONSTRAINT fg_certificado_glp_componente_mes_fabricacion_check CHECK ((((mes_fabricacion IS NULL) OR ((mes_fabricacion >= 1) AND (mes_fabricacion <= 12))))),
  CONSTRAINT 2200_172292_1_not_null CHECK (id IS NOT NULL),
  CONSTRAINT 2200_172292_2_not_null CHECK (certificado_id IS NOT NULL),
  CONSTRAINT 2200_172292_3_not_null CHECK (orden IS NOT NULL),
  CONSTRAINT 2200_172292_4_not_null CHECK (componente IS NOT NULL)
);

CREATE UNIQUE INDEX fg_certificado_glp_componente_pkey ON public.fg_certificado_glp_componente USING btree (id);

CREATE UNIQUE INDEX fg_certificado_glp_componente_certificado_id_orden_key ON public.fg_certificado_glp_componente USING btree (certificado_id, orden);

CREATE TABLE fg_certificado_glp_verificacion (
  id bigint NOT NULL DEFAULT nextval('fg_certificado_glp_verificacion_id_seq'::regclass),
  certificado_id bigint NOT NULL,
  codigo character varying(5) NOT NULL,
  orden smallint NOT NULL,
  descripcion text NOT NULL,
  cumple boolean NOT NULL,
  observacion text,
  CONSTRAINT fg_certificado_glp_verificacion_pkey PRIMARY KEY (id),
  CONSTRAINT fk_cert_glp_verif_cert FOREIGN KEY (certificado_id) REFERENCES fg_certificado_glp (certificado_id) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fg_certificado_glp_verificacion_certificado_id_codigo_key UNIQUE (certificado_id, codigo),
  CONSTRAINT fg_certificado_glp_verificacion_certificado_id_orden_key UNIQUE (certificado_id, orden),
  CONSTRAINT 2200_172312_1_not_null CHECK (id IS NOT NULL),
  CONSTRAINT 2200_172312_2_not_null CHECK (certificado_id IS NOT NULL),
  CONSTRAINT 2200_172312_3_not_null CHECK (codigo IS NOT NULL),
  CONSTRAINT 2200_172312_4_not_null CHECK (orden IS NOT NULL),
  CONSTRAINT 2200_172312_5_not_null CHECK (descripcion IS NOT NULL),
  CONSTRAINT 2200_172312_6_not_null CHECK (cumple IS NOT NULL)
);

CREATE UNIQUE INDEX fg_certificado_glp_verificacion_pkey ON public.fg_certificado_glp_verificacion USING btree (id);

CREATE UNIQUE INDEX fg_certificado_glp_verificacion_certificado_id_codigo_key ON public.fg_certificado_glp_verificacion USING btree (certificado_id, codigo);

CREATE UNIQUE INDEX fg_certificado_glp_verificacion_certificado_id_orden_key ON public.fg_certificado_glp_verificacion USING btree (certificado_id, orden);

CREATE TABLE fg_certificado_conformidad (
  certificado_id bigint NOT NULL,
  tipo_conformidad character varying(30) NOT NULL,
  tipo_tramite character varying(200),
  caracteristica_registrable character varying(300),
  motivo text,
  descripcion text,
  uso_original_vehiculo character varying(200),
  CONSTRAINT fg_certificado_conformidad_pkey PRIMARY KEY (certificado_id),
  CONSTRAINT fk_cert_conf_cert FOREIGN KEY (certificado_id) REFERENCES fg_certificado (id) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT 2200_172331_1_not_null CHECK (certificado_id IS NOT NULL),
  CONSTRAINT 2200_172331_2_not_null CHECK (tipo_conformidad IS NOT NULL)
);

CREATE UNIQUE INDEX fg_certificado_conformidad_pkey ON public.fg_certificado_conformidad USING btree (certificado_id);


-- Datos Iniciales
INSERT INTO fg_tipo_certificado (clave, nombre, descripcion, activo, fecha_creacion, fecha_modificacion, codigo) VALUES
('GNV_ANUAL', 'Certificado GNV Anual', '', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 22),
('GLP_ANUAL', 'Certificado GLP Anual', '', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 41),
('CONFORMIDAD', 'Certificado Conformidad', '', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 39);
```

## ORDEN DE EJECUCIÓN EN PRODUCCIÓN

El orden calculado según dependencias (FKs) es:

1. fg_planta
2. fg_taller_autorizado
3. fg_cliente
4. fg_tipo_certificado
5. fg_perfil
6. fg_permiso
7. fg_perfil_permiso
8. fg_perfil_planta
9. fg_usuario
10. fg_usuario_planta
11. fg_usuario_sesion
12. fg_auditoria_acceso
13. fg_correlativo_certificado
14. fg_certificado
15. fg_certificado_vehiculo
16. fg_certificado_titular
17. fg_certificado_gnv
18. fg_certificado_gnv_verificacion
19. fg_certificado_glp
20. fg_certificado_glp_componente
21. fg_certificado_glp_verificacion
22. fg_certificado_conformidad
