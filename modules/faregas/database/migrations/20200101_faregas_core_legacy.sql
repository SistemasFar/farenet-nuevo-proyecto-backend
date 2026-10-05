-- DUMP GENERADO AUTOMATICAMENTE: TABLAS BASE LEGACY
-- Módulo Faregas

CREATE TABLE IF NOT EXISTS fg_auditoria_acceso (
    id bigint NOT NULL DEFAULT nextval('fg_auditoria_acceso_id_seq'::regclass),
    username character varying(255),
    evento character varying(50) NOT NULL,
    exitoso boolean NOT NULL,
    mensaje text,
    planta_key character varying(20),
    ip_direccion character varying(45),
    user_agent character varying(1000),
    fecha_evento timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    categoria character varying(30) NOT NULL DEFAULT 'ACCESO'::character varying,
    entidad character varying(50),
    entidad_id bigint,
    certificado_id bigint,
    numero_certificado character varying(80),
    placa character varying(20),
    tipo_certificado character varying(50),
    paso character varying(50),
    datos jsonb,
    perfil character varying(50),
    PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS fg_auditoria_config (
    id bigint NOT NULL DEFAULT nextval('fg_auditoria_config_id_seq'::regclass),
    username character varying(255) NOT NULL,
    entidad character varying(50) NOT NULL,
    accion character varying(50) NOT NULL,
    identificador character varying(100) NOT NULL,
    detalles jsonb,
    planta_key character varying(20),
    fecha timestamp with time zone NOT NULL DEFAULT now(),
    ip_direccion character varying(50),
    PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS fg_certificado (
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
    tarifa_codigo character varying(50),
    paso_actual character varying(40) NOT NULL DEFAULT 'DATOS_INICIALES'::character varying,
    formato_version_id integer,
    formato_datos_snapshot jsonb,
    producto_facturacion_certificado_id bigint,
    precio_certificado numeric,
    producto_chip_id bigint,
    producto_facturacion_chip_id bigint,
    precio_chip numeric,
    importe_total numeric,
    PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS fg_certificado_conformidad (
    certificado_id bigint NOT NULL,
    tipo_conformidad character varying(30),
    tipo_tramite character varying(200),
    caracteristica_registrable character varying(300),
    motivo text,
    descripcion text,
    uso_original_vehiculo character varying(200),
    marca_modificacion boolean DEFAULT false,
    marca_montaje boolean DEFAULT false,
    marca_fabricacion boolean DEFAULT false,
    PRIMARY KEY (certificado_id)
);

CREATE TABLE IF NOT EXISTS fg_certificado_glp (
    certificado_id bigint NOT NULL,
    taller_autorizado_id bigint,
    expediente_tecnico character varying(100),
    vigencia_hasta date,
    taller_razon_social character varying(300),
    taller_sede character varying(200),
    taller_direccion character varying(500),
    taller_codigo_autorizacion character varying(100),
    modalidad character varying(20),
    combustible_posterior character varying(100),
    peso_neto_posterior numeric,
    carga_util_posterior numeric,
    PRIMARY KEY (certificado_id)
);

CREATE TABLE IF NOT EXISTS fg_certificado_glp_componente (
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
    PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS fg_certificado_glp_verificacion (
    id bigint NOT NULL DEFAULT nextval('fg_certificado_glp_verificacion_id_seq'::regclass),
    certificado_id bigint NOT NULL,
    codigo character varying(5) NOT NULL,
    orden smallint NOT NULL,
    descripcion text NOT NULL,
    cumple boolean,
    observacion text,
    PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS fg_certificado_gnv (
    certificado_id bigint NOT NULL,
    taller_autorizado_id bigint,
    vigencia_hasta date,
    taller_razon_social character varying(300),
    taller_sede character varying(200),
    taller_direccion character varying(500),
    taller_codigo_autorizacion character varying(100),
    modalidad character varying(20),
    numero_chip character varying(15),
    combustible_posterior character varying(100),
    peso_neto_posterior numeric,
    observaciones character varying(250),
    PRIMARY KEY (certificado_id)
);

CREATE TABLE IF NOT EXISTS fg_certificado_gnv_componente (
    id bigint NOT NULL DEFAULT nextval('fg_certificado_gnv_componente_id_seq'::regclass),
    certificado_id bigint NOT NULL,
    orden integer NOT NULL,
    componente character varying(100) NOT NULL,
    marca character varying(150),
    modelo character varying(150),
    capacidad_litros character varying(100),
    mes_fabricacion integer,
    anio_fabricacion integer,
    numero_serie character varying(150),
    PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS fg_certificado_gnv_verificacion (
    id bigint NOT NULL DEFAULT nextval('fg_certificado_gnv_verificacion_id_seq'::regclass),
    certificado_id bigint NOT NULL,
    codigo character varying(5) NOT NULL,
    orden smallint NOT NULL,
    descripcion text NOT NULL,
    cumple boolean,
    observacion text,
    PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS fg_certificado_titular (
    id bigint NOT NULL DEFAULT nextval('fg_certificado_titular_id_seq'::regclass),
    certificado_id bigint NOT NULL,
    cliente_id bigint,
    orden smallint NOT NULL,
    tipo_documento character varying(10),
    nro_documento character varying(20),
    nombre_razon_social character varying(300) NOT NULL,
    direccion character varying(500),
    PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS fg_certificado_vehiculo (
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
    PRIMARY KEY (certificado_id)
);

CREATE TABLE IF NOT EXISTS fg_cliente (
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
    PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS fg_correlativo_certificado (
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
    modalidad character varying(20) NOT NULL,
    PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS fg_perfil (
    clave character varying(255) NOT NULL,
    nombre character varying(255) NOT NULL,
    visible boolean,
    PRIMARY KEY (clave)
);

CREATE TABLE IF NOT EXISTS fg_perfil_permiso (
    perfil_clave character varying(255) NOT NULL,
    permiso_clave character varying(100) NOT NULL,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    PRIMARY KEY (perfil_clave, permiso_clave)
);

CREATE TABLE IF NOT EXISTS fg_perfil_planta (
    perfil_clave character varying(255) NOT NULL,
    planta_key character varying(20) NOT NULL,
    PRIMARY KEY (perfil_clave, planta_key)
);

CREATE TABLE IF NOT EXISTS fg_permiso (
    clave character varying(100) NOT NULL,
    nombre character varying(200) NOT NULL,
    modulo character varying(100) NOT NULL,
    descripcion text,
    activo boolean NOT NULL DEFAULT true,
    PRIMARY KEY (clave)
);

CREATE TABLE IF NOT EXISTS fg_planta (
    key character varying(20) NOT NULL,
    nombre character varying(150) NOT NULL,
    direccion character varying(500),
    telefono character varying(255),
    activo boolean NOT NULL DEFAULT true,
    empresa_key character varying NOT NULL,
    correo character varying(255),
    PRIMARY KEY (key)
);

CREATE TABLE IF NOT EXISTS fg_servicio (
    id integer NOT NULL DEFAULT nextval('fg_servicio_id_seq'::regclass),
    codigo character varying(50) NOT NULL,
    nombre character varying(150) NOT NULL,
    familia character varying(50) NOT NULL,
    tipo_certificado_clave character varying(50),
    modalidad character varying(50),
    requiere_certificado boolean NOT NULL DEFAULT true,
    requiere_vehiculo boolean NOT NULL DEFAULT true,
    activo boolean NOT NULL DEFAULT true,
    orden integer NOT NULL DEFAULT 0,
    categoria_id integer NOT NULL,
    tipo_flujo character varying(30) NOT NULL,
    formato_id integer,
    PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS fg_taller_autorizado (
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
    PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS fg_tarifa (
    id integer NOT NULL DEFAULT nextval('fg_tarifa_id_seq'::regclass),
    planta_key character varying(20) NOT NULL,
    codigo character varying(50) NOT NULL,
    familia character varying(30) NOT NULL,
    nombre character varying(150) NOT NULL,
    tipo_certificado_clave character varying(50),
    modalidad character varying(20),
    precio numeric NOT NULL,
    activo boolean NOT NULL DEFAULT true,
    orden integer NOT NULL DEFAULT 0,
    servicio_id integer NOT NULL,
    producto_facturacion_id bigint,
    PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS fg_tipo_certificado (
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
    ancho_correlativo smallint,
    PRIMARY KEY (clave)
);

CREATE TABLE IF NOT EXISTS fg_usuario (
    username character varying(255) NOT NULL,
    user_type character varying(31) NOT NULL,
    contrasenha character varying(255) NOT NULL,
    perfil_id character varying(255),
    persona_nrodocumentoidentidad character varying(20),
    estado boolean,
    foto text,
    PRIMARY KEY (username)
);

CREATE TABLE IF NOT EXISTS fg_usuario_planta (
    usuario_username character varying(255) NOT NULL,
    plantas_key character varying(20) NOT NULL,
    PRIMARY KEY (usuario_username, plantas_key)
);

CREATE TABLE IF NOT EXISTS fg_usuario_sesion (
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
    PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS fg_venta (
    id bigint NOT NULL DEFAULT nextval('fg_venta_id_seq'::regclass),
    planta_key character varying(50) NOT NULL,
    cliente_tipo_documento character varying(20) NOT NULL,
    cliente_nro_documento character varying(20) NOT NULL,
    cliente_nombre character varying(255) NOT NULL,
    cliente_direccion character varying(255),
    cliente_email character varying(255),
    base_imponible numeric NOT NULL,
    igv numeric NOT NULL,
    importe_total numeric NOT NULL,
    estado character varying(50) DEFAULT 'COMPLETADO'::character varying,
    creado_por character varying(100),
    creado_en timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS fg_venta_detalle (
    id bigint NOT NULL DEFAULT nextval('fg_venta_detalle_id_seq'::regclass),
    venta_id bigint NOT NULL,
    chip_id bigint NOT NULL,
    producto_inventariable_id bigint NOT NULL,
    precio_unitario numeric NOT NULL,
    cantidad integer DEFAULT 1,
    total numeric NOT NULL,
    PRIMARY KEY (id)
);

