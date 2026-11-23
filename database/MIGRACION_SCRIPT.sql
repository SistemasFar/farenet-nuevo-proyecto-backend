-- =============================================================================
-- FAREGAS — SCRIPT UNIFICADO DE MIGRACIÓN Y CONTROL DE ACCESO
-- =============================================================================
-- ARCHIVO: database/MIGRACION_SCRIPT.sql
-- SISTEMA: FAREGAS (Emisión, Facturación y Control Técnico-Administrativo)
-- MOTOR: PostgreSQL 13 o superior
-- CODIFICACIÓN: UTF-8
--
-- ARQUITECTURA Y REGLAS DE AISLAMIENTO:
-- 1. BASE DE DATOS COMPARTIDA: FAREGAS y FARENET comparten permanentemente
--    la misma base de datos PostgreSQL ('inspeccion'). No se separan bases.
-- 2. PRIVILEGIOS FAREGAS:
--    - DML completo (SELECT, INSERT, UPDATE, DELETE) y secuencias en tablas 'fg_*'.
--    - Acceso de SOLO LECTURA (SELECT) en tablas operativas FARENET autorizadas
--      ('persona', 'vehiculo', 'tarjetapropiedad') y catálogos compartidos.
--    - PROHIBICIÓN TOTAL de escritura (INSERT, UPDATE, DELETE, TRUNCATE) o DDL
--      sobre cualquier tabla operativa o catálogo perteneciente a FARENET.
-- 3. SEGURIDAD E IDEMPOTENCIA:
--    - Transaccional (BEGIN ... COMMIT).
--    - No destructivo: CERO DROP TABLE, CERO TRUNCATE, CERO DELETE masivos, CERO CASCADE.
--    - Sin contraseñas, secretos ni tokens en texto plano.
--    - Seguro para re-ejecución sin generar duplicados de esquemas ni errores.
--
-- ÍNDICE DE LAS 13 SECCIONES TEMÁTICAS REQUERIDAS:
--   1. Preparación y validaciones.
--   2. Creación de tablas.
--   3. Modificaciones de columnas.
--   4. Restricciones y claves foráneas.
--   5. Índices.
--   6. Funciones y triggers.
--   7. Migraciones de datos.
--   8. Catálogos y datos iniciales.
--   9. Custodia de credenciales y MFA.
--  10. Usuarios, perfiles y permisos.
--  11. Aislamiento de FAREGAS frente a FARENET.
--  12. Roles y privilegios PostgreSQL.
--  13. Validaciones finales.
--
-- INSTRUCCIONES DE EJECUCIÓN (ADMINISTRADOR / DBA):
--   psql -X -v ON_ERROR_STOP=1 -h <HOST> -U <DBA_USER> -d inspeccion -f database/MIGRACION_SCRIPT.sql
-- =============================================================================

-- =============================================================================
-- SECCIÓN 1: PREPARACIÓN Y VALIDACIONES
-- =============================================================================

BEGIN;

DO $faregas_inicio$
BEGIN
    RAISE NOTICE '=============================================================================';
    RAISE NOTICE 'FAREGAS: Iniciando ejecución controlada de MIGRACION_SCRIPT.sql';
    RAISE NOTICE 'Base de datos actual: %', current_database();
    RAISE NOTICE 'Arquitectura: Base compartida inspeccion con aislamiento de datos FARENET/FAREGAS';
    RAISE NOTICE '=============================================================================';
END;
$faregas_inicio$;

SET LOCAL search_path TO public, pg_catalog;

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ==== migrations/000_faregas_schema_completo.sql ====
-- ============================================================================
-- ARCHIVO: 000_faregas_schema_completo.sql
-- MÓDULO: FAREGAS (Emisión, Facturación y Control Técnico-Administrativo)
-- DESTINO: Instalación DDL completa para futura base de datos independiente
-- MOTOR: PostgreSQL 13 o superior
-- CODIFICACIÓN: UTF-8
--
-- COMPATIBILIDAD ARQUITECTÓNICA:
-- Este bloque contiene el esquema base de FAREGAS adaptado para la base de datos
-- compartida 'inspeccion' o para entornos de prueba aislados. No sobreescribe catálogos de FARENET.
--
-- CONTENIDO:
-- 1. Extensiones requeridas (btree_gist)
-- 2. Funciones PL/pgSQL de protección de inmutabilidad operativa
-- 3. Secuencias propias de autoincremento (32 secuencias)
-- 4. Tablas del módulo FAREGAS (70 tablas: 69 operativas + fg_usuario_perfil)
-- 5. Claves primarias (PK), restricciones de unicidad (UNIQUE) y chequeos (CHECK)
-- 6. Índices secundarios (118 índices de optimización)
-- 7. Triggers de inmutabilidad operativa
-- 8. Claves foráneas internas entre tablas fg_* (176 FKs)
-- 9. Catálogos stub y Claves foráneas externas hacia FARENET (12 FKs)
-- ============================================================================

SET statement_timeout = 0;
SET lock_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

-- ============================================================================
-- 1. EXTENSIONES REQUERIDAS
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ============================================================================
-- 2. FUNCIONES DE PROTECCIÓN DE INMUTABILIDAD PL/pgSQL
-- ============================================================================

-- =============================================================================
-- SECCIÓN 6: FUNCIONES Y TRIGGERS
-- =============================================================================

DO $faregas_schema_000$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'fg_auditoria_acceso'
    ) THEN
        RAISE NOTICE 'Iniciando instalación del esquema base 000 de FAREGAS...';
CREATE OR REPLACE FUNCTION public.fg_bloquear_mutacion_movimiento_inventario_cantidad()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
    RAISE EXCEPTION 'Los movimientos de inventario por cantidad son inmutables';
END;
$function$;

CREATE OR REPLACE FUNCTION public.fg_bloquear_mutacion_solicitud_evento()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
    RAISE EXCEPTION 'El historial de solicitudes administrativas es inmutable.' USING ERRCODE = '55000';
END;
$function$;

--
SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: fg_auditoria_acceso; Type: TABLE; Schema: public; Owner: postgres
--

-- =============================================================================
-- SECCIÓN 2: CREACIÓN DE TABLAS (fg_*)
-- =============================================================================
CREATE TABLE public.fg_auditoria_acceso (
    id bigint NOT NULL,
    username character varying(255),
    evento character varying(100) NOT NULL,
    exitoso boolean NOT NULL,
    mensaje text,
    planta_key character varying(20),
    ip_direccion character varying(45),
    user_agent character varying(1000),
    fecha_evento timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    categoria character varying(50) DEFAULT 'ACCESO'::character varying NOT NULL,
    entidad character varying(50),
    entidad_id bigint,
    certificado_id bigint,
    numero_certificado character varying(80),
    placa character varying(20),
    tipo_certificado character varying(50),
    paso character varying(50),
    datos jsonb,
    perfil character varying(50),
    usuario_id bigint,
    modulo character varying(50),
    resultado character varying(20) DEFAULT 'EXITO'::character varying NOT NULL,
    motivo_error text,
    documento_referencia character varying(100),
    es_automatico boolean DEFAULT false NOT NULL,
    correlacion_id character varying(100),
    datos_previos jsonb,
    datos_nuevos jsonb
);



--
-- Name: TABLE fg_auditoria_acceso; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.fg_auditoria_acceso IS 'Bitácora inmutable de accesos y operaciones relevantes del subsistema FAREGAS';


--
-- Name: COLUMN fg_auditoria_acceso.datos; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.fg_auditoria_acceso.datos IS 'Resumen técnico no sensible del evento; no debe almacenar contraseñas, tokens ni datos completos de pago';


--
-- Name: COLUMN fg_auditoria_acceso.perfil; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.fg_auditoria_acceso.perfil IS 'Perfil histórico que tenía el usuario al momento de la operación';


--
-- Name: fg_auditoria_acceso_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.fg_auditoria_acceso_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: fg_auditoria_acceso_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.fg_auditoria_acceso_id_seq OWNED BY public.fg_auditoria_acceso.id;


--
-- Name: fg_auditoria_config; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.fg_auditoria_config (
    id bigint NOT NULL,
    username character varying(255) NOT NULL,
    entidad character varying(50) NOT NULL,
    accion character varying(50) NOT NULL,
    identificador character varying(100) NOT NULL,
    detalles jsonb,
    planta_key character varying(20),
    fecha timestamp with time zone DEFAULT now() NOT NULL,
    ip_direccion character varying(50)
);



--
-- Name: fg_auditoria_config_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.fg_auditoria_config_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: fg_auditoria_config_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.fg_auditoria_config_id_seq OWNED BY public.fg_auditoria_config.id;


--
-- Name: fg_categoria_servicio; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.fg_categoria_servicio (
    id integer NOT NULL,
    codigo character varying(50) NOT NULL,
    nombre character varying(100) NOT NULL,
    descripcion text,
    activo boolean DEFAULT true NOT NULL,
    orden integer DEFAULT 0 NOT NULL,
    fecha_creacion timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    fecha_modificacion timestamp without time zone
);



--
-- Name: fg_categoria_servicio_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.fg_categoria_servicio ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.fg_categoria_servicio_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: fg_certificado; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.fg_certificado (
    id bigint NOT NULL,
    tipo_certificado_clave character varying(30) NOT NULL,
    numero_certificado character varying(50),
    cliente_id bigint,
    planta_key character varying(20) NOT NULL,
    fecha_emision date,
    estado character varying(30),
    observaciones text,
    usuario_creacion character varying(255) NOT NULL,
    fecha_creacion timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    usuario_modificacion character varying(255),
    fecha_modificacion timestamp without time zone,
    entidad_certificadora_nombre character varying(300),
    resolucion_directoral character varying(150),
    domicilio_fiscal character varying(500),
    telefono_certificadora character varying(30),
    lugar_emision character varying(150),
    tarifa_codigo character varying(50),
    paso_actual character varying(40) DEFAULT 'DATOS_INICIALES'::character varying NOT NULL,
    formato_version_id integer,
    formato_datos_snapshot jsonb,
    producto_facturacion_certificado_id bigint,
    precio_certificado numeric(10,2),
    producto_chip_id bigint,
    producto_facturacion_chip_id bigint,
    precio_chip numeric(10,2),
    importe_total numeric(10,2),
    fecha_anulacion timestamp with time zone,
    motivo_anulacion character varying(500),
    solicitud_anulacion_id bigint,
    usuario_anulacion character varying(255),
    fecha_hora_emision timestamp with time zone,
    CONSTRAINT ck_fg_certificado_paso_actual CHECK (((paso_actual)::text = ANY ((ARRAY['DATOS_INICIALES'::character varying, 'PAGO'::character varying, 'VEHICULO'::character varying, 'FACTURACION'::character varying, 'PREVISUALIZACION'::character varying, 'VERIFICACION_EMISION'::character varying])::text[])))
);



--
-- Name: COLUMN fg_certificado.fecha_hora_emision; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.fg_certificado.fecha_hora_emision IS 'Instante real de emisión (transacción BORRADOR->EMITIDO). NULL=histórico sin hora.';


--
-- Name: fg_certificado_chip; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.fg_certificado_chip (
    certificado_id bigint NOT NULL,
    chip_id bigint NOT NULL,
    fecha_asociacion timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);



--
-- Name: fg_certificado_conformidad; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.fg_certificado_conformidad (
    certificado_id bigint NOT NULL,
    tipo_conformidad character varying(30),
    tipo_tramite character varying(200),
    caracteristica_registrable character varying(300),
    motivo text,
    descripcion text,
    uso_original_vehiculo character varying(200),
    marca_modificacion boolean DEFAULT false,
    marca_montaje boolean DEFAULT false,
    marca_fabricacion boolean DEFAULT false
);



--
-- Name: fg_certificado_duplicado; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.fg_certificado_duplicado (
    id bigint NOT NULL,
    certificado_original_id bigint NOT NULL,
    operacion_id bigint NOT NULL,
    facturacion_id bigint,
    planta_key character varying(20) NOT NULL,
    placa character varying(12) NOT NULL,
    tipo_certificado_clave character varying(30) NOT NULL,
    modalidad character varying(20) NOT NULL,
    numero_certificado_snapshot character varying(50) NOT NULL,
    tipo_nombre_snapshot character varying(150) NOT NULL,
    fecha_emision_snapshot date NOT NULL,
    fecha_limite_snapshot date NOT NULL,
    html_original_snapshot text NOT NULL,
    motivo character varying(30) DEFAULT 'PERDIDA'::character varying NOT NULL,
    observacion text,
    precio numeric(10,2) DEFAULT 50.00 NOT NULL,
    estado character varying(30) DEFAULT 'PENDIENTE_PAGO'::character varying NOT NULL,
    solicitado_por character varying(255) NOT NULL,
    fecha_solicitud timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    fecha_disponible timestamp without time zone,
    cantidad_descargas integer DEFAULT 0 NOT NULL,
    ultima_descarga timestamp without time zone,
    fecha_modificacion timestamp without time zone,
    CONSTRAINT ck_fg_certificado_duplicado_descargas CHECK ((cantidad_descargas >= 0)),
    CONSTRAINT ck_fg_certificado_duplicado_estado CHECK (((estado)::text = ANY (ARRAY[('PENDIENTE_PAGO'::character varying)::text, ('PENDIENTE_COMPROBANTE'::character varying)::text, ('DISPONIBLE'::character varying)::text, ('ANULADO'::character varying)::text]))),
    CONSTRAINT ck_fg_certificado_duplicado_modalidad CHECK (((modalidad)::text = ANY (ARRAY[('INICIAL'::character varying)::text, ('ANUAL'::character varying)::text]))),
    CONSTRAINT ck_fg_certificado_duplicado_motivo CHECK (((motivo)::text = 'PERDIDA'::text)),
    CONSTRAINT ck_fg_certificado_duplicado_precio CHECK ((precio = 50.00))
);



--
-- Name: fg_certificado_duplicado_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.fg_certificado_duplicado ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.fg_certificado_duplicado_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: fg_certificado_formato; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.fg_certificado_formato (
    id integer NOT NULL,
    codigo character varying(50) NOT NULL,
    nombre character varying(150) NOT NULL,
    motor character varying(30) NOT NULL,
    es_protegido boolean DEFAULT false,
    activo boolean DEFAULT true,
    creado_en timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    actualizado_en timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    formato_padre_id integer,
    CONSTRAINT fg_certificado_formato_motor_check CHECK (((motor)::text = ANY ((ARRAY['SISTEMA'::character varying, 'DOCX_DINAMICO'::character varying, 'HTML_DINAMICO'::character varying])::text[])))
);



--
-- Name: fg_certificado_formato_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.fg_certificado_formato_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: fg_certificado_formato_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.fg_certificado_formato_id_seq OWNED BY public.fg_certificado_formato.id;


--
-- Name: fg_certificado_formato_version; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.fg_certificado_formato_version (
    id integer NOT NULL,
    formato_id integer NOT NULL,
    version integer NOT NULL,
    archivo_ruta character varying(255),
    configuracion jsonb,
    estado character varying(20) NOT NULL,
    vigente_desde timestamp without time zone,
    creado_por integer,
    creado_en timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    motor character varying(50),
    CONSTRAINT fg_certificado_formato_version_estado_check CHECK (((estado)::text = ANY ((ARRAY['BORRADOR'::character varying, 'VIGENTE'::character varying, 'RETIRADA'::character varying])::text[])))
);



--
-- Name: fg_certificado_formato_version_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.fg_certificado_formato_version_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: fg_certificado_formato_version_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.fg_certificado_formato_version_id_seq OWNED BY public.fg_certificado_formato_version.id;


--
-- Name: fg_certificado_glp; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.fg_certificado_glp (
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
    peso_neto_posterior character varying(50),
    carga_util_posterior character varying(50)
);



--
-- Name: fg_certificado_glp_componente; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.fg_certificado_glp_componente (
    id bigint NOT NULL,
    certificado_id bigint NOT NULL,
    orden smallint NOT NULL,
    componente character varying(100) NOT NULL,
    marca character varying(150),
    modelo character varying(150),
    capacidad_litros numeric(10,2),
    mes_fabricacion smallint,
    anio_fabricacion smallint,
    numero_serie character varying(200),
    CONSTRAINT fg_certificado_glp_componente_mes_fabricacion_check CHECK (((mes_fabricacion IS NULL) OR ((mes_fabricacion >= 1) AND (mes_fabricacion <= 12))))
);



--
-- Name: fg_certificado_glp_componente_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.fg_certificado_glp_componente_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: fg_certificado_glp_componente_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.fg_certificado_glp_componente_id_seq OWNED BY public.fg_certificado_glp_componente.id;


--
-- Name: fg_certificado_glp_verificacion; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.fg_certificado_glp_verificacion (
    id bigint NOT NULL,
    certificado_id bigint NOT NULL,
    codigo character varying(5) NOT NULL,
    orden smallint NOT NULL,
    descripcion text NOT NULL,
    cumple boolean,
    observacion text
);



--
-- Name: fg_certificado_glp_verificacion_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.fg_certificado_glp_verificacion_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: fg_certificado_glp_verificacion_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.fg_certificado_glp_verificacion_id_seq OWNED BY public.fg_certificado_glp_verificacion.id;


--
-- Name: fg_certificado_gnv; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.fg_certificado_gnv (
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
    peso_neto_posterior character varying(50),
    observaciones character varying(250),
    taller_planta_key character varying(20)
);



--
-- Name: COLUMN fg_certificado_gnv.observaciones; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.fg_certificado_gnv.observaciones IS 'Observaciones del certificado GNV escritas por el inspector. Opcional. Limite 250 caracteres.';


--
-- Name: fg_certificado_gnv_componente; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.fg_certificado_gnv_componente (
    id bigint NOT NULL,
    certificado_id bigint NOT NULL,
    orden integer NOT NULL,
    componente character varying(100) NOT NULL,
    marca character varying(150),
    modelo character varying(150),
    capacidad_litros character varying(100),
    mes_fabricacion integer,
    anio_fabricacion integer,
    numero_serie character varying(150),
    CONSTRAINT fg_certificado_gnv_componente_mes_fabricacion_check CHECK (((mes_fabricacion >= 1) AND (mes_fabricacion <= 12)))
);



--
-- Name: fg_certificado_gnv_componente_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.fg_certificado_gnv_componente_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: fg_certificado_gnv_componente_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.fg_certificado_gnv_componente_id_seq OWNED BY public.fg_certificado_gnv_componente.id;


--
-- Name: fg_certificado_gnv_verificacion; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.fg_certificado_gnv_verificacion (
    id bigint NOT NULL,
    certificado_id bigint NOT NULL,
    codigo character varying(5) NOT NULL,
    orden smallint NOT NULL,
    descripcion text NOT NULL,
    cumple boolean,
    observacion text
);



--
-- Name: fg_certificado_gnv_verificacion_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.fg_certificado_gnv_verificacion_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: fg_certificado_gnv_verificacion_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.fg_certificado_gnv_verificacion_id_seq OWNED BY public.fg_certificado_gnv_verificacion.id;


--
-- Name: fg_certificado_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.fg_certificado_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: fg_certificado_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.fg_certificado_id_seq OWNED BY public.fg_certificado.id;


--
-- Name: fg_certificado_titular; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.fg_certificado_titular (
    id bigint NOT NULL,
    certificado_id bigint NOT NULL,
    cliente_id bigint,
    orden smallint NOT NULL,
    tipo_documento character varying(10),
    nro_documento character varying(20),
    nombre_razon_social character varying(300) NOT NULL,
    direccion character varying(500)
);



--
-- Name: fg_certificado_titular_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.fg_certificado_titular_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: fg_certificado_titular_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.fg_certificado_titular_id_seq OWNED BY public.fg_certificado_titular.id;


--
-- Name: fg_certificado_vehiculo; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.fg_certificado_vehiculo (
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
    numero_cilindros character varying(50),
    cilindrada character varying(50),
    numero_ejes character varying(50),
    numero_ruedas character varying(50),
    numero_asientos character varying(50),
    numero_pasajeros character varying(50),
    longitud character varying(50),
    ancho character varying(50),
    alto character varying(50),
    peso_neto character varying(50),
    peso_bruto character varying(50),
    carga_util character varying(50),
    potencia character varying(100),
    formula_rodante character varying(50)
);



--
-- Name: fg_certificado_version; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.fg_certificado_version (
    id bigint NOT NULL,
    certificado_id bigint NOT NULL,
    solicitud_id bigint,
    numero_version integer NOT NULL,
    estado_version character varying(30) NOT NULL,
    es_vigente boolean DEFAULT false NOT NULL,
    fecha_emision_original date NOT NULL,
    fecha_version timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    fecha_aplicacion_oficial timestamp with time zone,
    usuario_creacion character varying(255) NOT NULL,
    usuario_aprobacion character varying(255),
    motivo text NOT NULL,
    snapshot_datos jsonb NOT NULL,
    diferencias jsonb,
    enlace_pdf_original text,
    enlace_pdf_version text,
    metadatos jsonb,
    CONSTRAINT ck_fg_certificado_version_estado CHECK (((estado_version)::text = ANY ((ARRAY['ORIGINAL'::character varying, 'PROPUESTA'::character varying, 'PREPARADA'::character varying, 'VIGENTE'::character varying, 'SUSTITUIDA'::character varying, 'RECHAZADA'::character varying])::text[])))
);



--
-- Name: fg_certificado_version_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.fg_certificado_version_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: fg_certificado_version_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.fg_certificado_version_id_seq OWNED BY public.fg_certificado_version.id;


--
-- Name: fg_chip; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.fg_chip (
    id bigint NOT NULL,
    producto_inventariable_id bigint NOT NULL,
    numero_chip character varying(120) NOT NULL,
    planta_actual_key character varying NOT NULL,
    estado character varying(20) DEFAULT 'DISPONIBLE'::character varying NOT NULL,
    operacion_reserva_id bigint,
    reservado_en timestamp without time zone,
    creado_por character varying NOT NULL,
    creado_en timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    actualizado_por character varying,
    actualizado_en timestamp without time zone,
    CONSTRAINT ck_fg_chip_estado CHECK (((estado)::text = ANY ((ARRAY['DISPONIBLE'::character varying, 'RESERVADO'::character varying, 'VENDIDO'::character varying, 'BAJA'::character varying])::text[]))),
    CONSTRAINT ck_fg_chip_numero CHECK ((btrim((numero_chip)::text) <> ''::text)),
    CONSTRAINT ck_fg_chip_reserva CHECK (((((estado)::text = 'RESERVADO'::text) AND (reservado_en IS NOT NULL)) OR (((estado)::text <> 'RESERVADO'::text) AND (operacion_reserva_id IS NULL) AND (reservado_en IS NULL))))
);



--
-- Name: fg_chip_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.fg_chip ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.fg_chip_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: fg_chip_movimiento; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.fg_chip_movimiento (
    id bigint NOT NULL,
    chip_id bigint NOT NULL,
    tipo_movimiento character varying(20) NOT NULL,
    planta_origen_key character varying,
    planta_destino_key character varying,
    usuario character varying NOT NULL,
    fecha timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    referencia character varying(200),
    certificado_id bigint,
    operacion_comercial_id bigint,
    detalles jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT ck_fg_chip_movimiento_tipo CHECK (((tipo_movimiento)::text = ANY ((ARRAY['INGRESO'::character varying, 'TRANSFERENCIA'::character varying, 'RESERVA'::character varying, 'LIBERACION'::character varying, 'VENTA'::character varying, 'AJUSTE'::character varying, 'BAJA'::character varying])::text[])))
);



--
-- Name: fg_chip_movimiento_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.fg_chip_movimiento ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.fg_chip_movimiento_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: fg_cliente; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.fg_cliente (
    id bigint NOT NULL,
    tipo_documento character varying(10) NOT NULL,
    nro_documento character varying(20) NOT NULL,
    nombre_razon_social character varying(300) NOT NULL,
    direccion character varying(500),
    telefono character varying(30),
    correo character varying(200),
    estado boolean DEFAULT true NOT NULL,
    fecha_creacion timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    fecha_modificacion timestamp without time zone
);



--
-- Name: fg_cliente_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.fg_cliente_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: fg_cliente_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.fg_cliente_id_seq OWNED BY public.fg_cliente.id;


--
-- Name: fg_correlativo_certificado; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.fg_correlativo_certificado (
    id bigint NOT NULL,
    tipo_certificado_clave character varying(30) NOT NULL,
    nro_actual bigint DEFAULT 0 NOT NULL,
    activo boolean DEFAULT true NOT NULL,
    fecha_modificacion timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    planta_key character varying(20) NOT NULL,
    nro_inicio bigint NOT NULL,
    nro_maximo bigint NOT NULL,
    fecha_asignacion timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    fecha_cierre timestamp without time zone,
    modalidad character varying(20) NOT NULL,
    CONSTRAINT chk_cierre CHECK (((activo = false) OR (fecha_cierre IS NULL))),
    CONSTRAINT chk_fg_correlativo_modalidad CHECK (((modalidad)::text = ANY ((ARRAY['INICIAL'::character varying, 'ANUAL'::character varying, 'UNICA'::character varying])::text[]))),
    CONSTRAINT chk_nro_actual_max CHECK ((nro_actual <= nro_maximo)),
    CONSTRAINT chk_nro_actual_min CHECK ((nro_actual >= (nro_inicio - 1))),
    CONSTRAINT chk_nro_inicio CHECK ((nro_inicio > 0)),
    CONSTRAINT chk_nro_maximo CHECK ((nro_maximo >= nro_inicio))
);



--
-- Name: TABLE fg_correlativo_certificado; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.fg_correlativo_certificado IS 'Rangos de numeracion de certificados FAREGAS por sede, tipo y modalidad. Los rangos 100000+ son provisionales de desarrollo.';


--
-- Name: COLUMN fg_correlativo_certificado.modalidad; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.fg_correlativo_certificado.modalidad IS 'Modalidad exacta del rango: INICIAL, ANUAL o UNICA para Conformidad.';


--
-- Name: fg_correlativo_certificado_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.fg_correlativo_certificado_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: fg_correlativo_certificado_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.fg_correlativo_certificado_id_seq OWNED BY public.fg_correlativo_certificado.id;


--
-- Name: fg_correlativo_certificado_sede; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.fg_correlativo_certificado_sede (
    id bigint NOT NULL,
    planta_key character varying NOT NULL,
    rango_inicio bigint NOT NULL,
    rango_fin bigint NOT NULL,
    numero_actual bigint NOT NULL,
    cantidad bigint GENERATED ALWAYS AS (((rango_fin - rango_inicio) + 1)) STORED,
    disponibles bigint GENERATED ALWAYS AS ((rango_fin - numero_actual)) STORED,
    estado character varying DEFAULT 'ACTIVO'::character varying NOT NULL,
    fecha_asignacion timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    fecha_cierre timestamp without time zone,
    observacion character varying(500),
    fecha_creacion timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    fecha_modificacion timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT chk_corr_sede_actual CHECK (((numero_actual >= (rango_inicio - 1)) AND (numero_actual <= rango_fin))),
    CONSTRAINT chk_corr_sede_agotado_coherente CHECK ((((estado)::text <> 'AGOTADO'::text) OR (numero_actual >= rango_fin))),
    CONSTRAINT chk_corr_sede_agotado_sin_cierre CHECK ((((estado)::text <> 'AGOTADO'::text) OR (fecha_cierre IS NULL))),
    CONSTRAINT chk_corr_sede_cantidad CHECK (((((rango_fin - rango_inicio) + 1) >= 1) AND (((rango_fin - rango_inicio) + 1) <= 50))),
    CONSTRAINT chk_corr_sede_cierre CHECK ((((estado)::text <> 'CERRADO'::text) OR (fecha_cierre IS NOT NULL))),
    CONSTRAINT chk_corr_sede_desde CHECK ((rango_inicio > 0)),
    CONSTRAINT chk_corr_sede_estado CHECK (((estado)::text = ANY ((ARRAY['ACTIVO'::character varying, 'AGOTADO'::character varying, 'CERRADO'::character varying])::text[]))),
    CONSTRAINT chk_corr_sede_hasta CHECK ((rango_fin >= rango_inicio))
);



--
-- Name: fg_correlativo_certificado_sede_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.fg_correlativo_certificado_sede_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: fg_correlativo_certificado_sede_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.fg_correlativo_certificado_sede_id_seq OWNED BY public.fg_correlativo_certificado_sede.id;


--
-- Name: fg_credito; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.fg_credito (
    id bigint NOT NULL,
    planta_key character varying NOT NULL,
    facturacion_id bigint NOT NULL,
    serie_comprobante_id bigint,
    motivo_codigo character varying(10),
    sustento text,
    serie character varying(30),
    numero bigint,
    nro_comprobante character varying(80),
    moneda_key character varying DEFAULT 'sol'::character varying NOT NULL,
    base_imponible numeric(14,2) DEFAULT 0 NOT NULL,
    igv numeric(14,2) DEFAULT 0 NOT NULL,
    importe_total numeric(14,2) DEFAULT 0 NOT NULL,
    estado character varying(20) DEFAULT 'BORRADOR'::character varying NOT NULL,
    proveedor character varying(30) DEFAULT 'NUBEFACT'::character varying NOT NULL,
    aceptada_sunat boolean,
    respuesta_proveedor jsonb,
    usuario_creacion character varying NOT NULL,
    fecha_creacion timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    usuario_modificacion character varying,
    fecha_modificacion timestamp without time zone,
    empresa_key character varying,
    ruc_emisor character varying(11),
    codigo_unico character varying(20),
    sunat_description text,
    sunat_responsecode character varying(50),
    sunat_soap_error text,
    enlace_pdf text,
    enlace_xml text,
    enlace_cdr text,
    intentos integer DEFAULT 0 NOT NULL,
    fecha_ultimo_intento timestamp without time zone,
    fecha_aceptacion timestamp without time zone,
    sujeto_detraccion boolean,
    detraccion_codigo character varying(10),
    detraccion_descripcion character varying(255),
    detraccion_porcentaje numeric(5,2),
    detraccion_base numeric(12,2),
    detraccion_monto numeric(12,2),
    detraccion_neto numeric(12,2),
    detraccion_estado_deposito character varying(30),
    detraccion_constancia_nro character varying(50),
    detraccion_constancia_fecha date,
    detraccion_motivo_exclusion character varying(150),
    CONSTRAINT ck_fg_credito_estado CHECK (((estado)::text = ANY ((ARRAY['BORRADOR'::character varying, 'PENDIENTE'::character varying, 'ACEPTADO'::character varying, 'RECHAZADO'::character varying, 'ERROR'::character varying, 'ANULADO'::character varying])::text[]))),
    CONSTRAINT ck_fg_credito_importes CHECK (((base_imponible >= (0)::numeric) AND (igv >= (0)::numeric) AND (importe_total >= (0)::numeric))),
    CONSTRAINT ck_fg_credito_numero CHECK (((numero IS NULL) OR (numero > 0)))
);



--
-- Name: fg_credito_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.fg_credito_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: fg_credito_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.fg_credito_id_seq OWNED BY public.fg_credito.id;


--
-- Name: fg_debito; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.fg_debito (
    id bigint NOT NULL,
    planta_key character varying NOT NULL,
    facturacion_id bigint NOT NULL,
    serie_comprobante_id bigint,
    motivo_codigo character varying(10),
    sustento text,
    serie character varying(30),
    numero bigint,
    nro_comprobante character varying(80),
    moneda_key character varying DEFAULT 'sol'::character varying NOT NULL,
    base_imponible numeric(14,2) DEFAULT 0 NOT NULL,
    igv numeric(14,2) DEFAULT 0 NOT NULL,
    importe_total numeric(14,2) DEFAULT 0 NOT NULL,
    estado character varying(20) DEFAULT 'BORRADOR'::character varying NOT NULL,
    proveedor character varying(30) DEFAULT 'NUBEFACT'::character varying NOT NULL,
    aceptada_sunat boolean,
    respuesta_proveedor jsonb,
    usuario_creacion character varying NOT NULL,
    fecha_creacion timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    usuario_modificacion character varying,
    fecha_modificacion timestamp without time zone,
    empresa_key character varying,
    ruc_emisor character varying(11),
    codigo_unico character varying(20),
    sunat_description text,
    sunat_responsecode character varying(50),
    sunat_soap_error text,
    enlace_pdf text,
    enlace_xml text,
    enlace_cdr text,
    intentos integer DEFAULT 0 NOT NULL,
    fecha_ultimo_intento timestamp without time zone,
    fecha_aceptacion timestamp without time zone,
    CONSTRAINT ck_fg_debito_estado CHECK (((estado)::text = ANY ((ARRAY['BORRADOR'::character varying, 'PENDIENTE'::character varying, 'ACEPTADO'::character varying, 'RECHAZADO'::character varying, 'ERROR'::character varying, 'ANULADO'::character varying])::text[]))),
    CONSTRAINT ck_fg_debito_importes CHECK (((base_imponible >= (0)::numeric) AND (igv >= (0)::numeric) AND (importe_total >= (0)::numeric))),
    CONSTRAINT ck_fg_debito_numero CHECK (((numero IS NULL) OR (numero > 0)))
);



--
-- Name: fg_debito_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.fg_debito_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: fg_debito_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.fg_debito_id_seq OWNED BY public.fg_debito.id;


--
-- Name: fg_descuento; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.fg_descuento (
    id bigint NOT NULL,
    codigo character varying NOT NULL,
    nombre character varying NOT NULL,
    tipo character varying NOT NULL,
    empresa_aliada_ruc character varying,
    empresa_aliada_nombre character varying,
    tipo_calculo character varying,
    valor numeric(14,2),
    fecha_inicio timestamp without time zone NOT NULL,
    fecha_fin timestamp without time zone NOT NULL,
    planta_key character varying,
    activo boolean DEFAULT true NOT NULL,
    usuario_creacion character varying NOT NULL,
    fecha_creacion timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    usuario_modificacion character varying,
    fecha_modificacion timestamp without time zone,
    ejecutivo character varying(150),
    ejecutivo_id bigint,
    CONSTRAINT chk_fg_descuento_fechas CHECK ((fecha_fin >= fecha_inicio)),
    CONSTRAINT chk_fg_descuento_porcentaje CHECK ((((tipo_calculo)::text = 'MONTO'::text) OR (((tipo_calculo)::text = 'PORCENTAJE'::text) AND (valor <= (100)::numeric)))),
    CONSTRAINT chk_fg_descuento_tipo CHECK (((tipo)::text = ANY ((ARRAY['CAMPANA'::character varying, 'ALIANZA'::character varying, 'CONVENIO'::character varying, 'PROMOCION'::character varying])::text[]))),
    CONSTRAINT chk_fg_descuento_tipo_calculo CHECK (((tipo_calculo)::text = ANY ((ARRAY['MONTO'::character varying, 'PORCENTAJE'::character varying])::text[]))),
    CONSTRAINT chk_fg_descuento_valor CHECK ((valor > (0)::numeric))
);



--
-- Name: COLUMN fg_descuento.tipo; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.fg_descuento.tipo IS 'Tipo de campaña FAREGAS: CAMPANA, ALIANZA, CONVENIO o PROMOCION';


--
-- Name: COLUMN fg_descuento.ejecutivo; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.fg_descuento.ejecutivo IS 'Nombre histórico del ejecutivo al momento de registrar el descuento';


--
-- Name: COLUMN fg_descuento.ejecutivo_id; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.fg_descuento.ejecutivo_id IS 'Ejecutivo FAREGAS relacionado con la alianza';


--
-- Name: fg_descuento_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.fg_descuento_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: fg_descuento_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.fg_descuento_id_seq OWNED BY public.fg_descuento.id;


--
-- Name: fg_descuentocliente; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.fg_descuentocliente (
    id bigint NOT NULL,
    descuento_id bigint NOT NULL,
    codigo character varying NOT NULL,
    tipo_documento character varying,
    nro_documento character varying,
    placa character varying,
    fecha_inicio timestamp without time zone,
    fecha_fin timestamp without time zone,
    max_usos integer DEFAULT 1 NOT NULL,
    usos_realizados integer DEFAULT 0 NOT NULL,
    activo boolean DEFAULT true NOT NULL,
    usuario_creacion character varying NOT NULL,
    fecha_creacion timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    usuario_modificacion character varying,
    fecha_modificacion timestamp without time zone,
    planta_key character varying,
    tipo_calculo character varying,
    valor_contado numeric(14,2),
    valor_credito numeric(14,2),
    CONSTRAINT chk_fg_descuentocliente_fechas CHECK ((((fecha_inicio IS NULL) AND (fecha_fin IS NULL)) OR (fecha_fin >= fecha_inicio))),
    CONSTRAINT chk_fg_descuentocliente_tipo_calculo CHECK (((tipo_calculo IS NULL) OR ((tipo_calculo)::text = ANY ((ARRAY['FLAT'::character varying, 'MONTO'::character varying, 'PORCENTAJE'::character varying])::text[])))),
    CONSTRAINT chk_fg_descuentocliente_tipo_doc CHECK (((tipo_documento IS NULL) OR ((tipo_documento)::text = ANY ((ARRAY['DNI'::character varying, 'RUC'::character varying])::text[])))),
    CONSTRAINT chk_fg_descuentocliente_usos CHECK (((max_usos > 0) AND (usos_realizados >= 0) AND (usos_realizados <= max_usos))),
    CONSTRAINT chk_fg_descuentocliente_valores CHECK ((((valor_contado IS NULL) OR (valor_contado > (0)::numeric)) AND ((valor_credito IS NULL) OR (valor_credito > (0)::numeric)) AND (((tipo_calculo)::text <> 'PORCENTAJE'::text) OR (((valor_contado IS NULL) OR (valor_contado <= (100)::numeric)) AND ((valor_credito IS NULL) OR (valor_credito <= (100)::numeric))))))
);



--
-- Name: fg_descuentocliente_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.fg_descuentocliente_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: fg_descuentocliente_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.fg_descuentocliente_id_seq OWNED BY public.fg_descuentocliente.id;


--
-- Name: fg_descuentocomprobante; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.fg_descuentocomprobante (
    id bigint NOT NULL,
    descuento_cliente_id bigint,
    certificado_id bigint NOT NULL,
    orden_pago_id bigint,
    facturacion_id bigint,
    importe_original numeric(14,2) NOT NULL,
    importe_descuento numeric(14,2) NOT NULL,
    importe_final numeric(14,2) NOT NULL,
    estado character varying NOT NULL,
    reservado_hasta timestamp without time zone NOT NULL,
    fecha_aplicacion timestamp without time zone,
    usuario_creacion character varying NOT NULL,
    fecha_creacion timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    usuario_modificacion character varying,
    fecha_modificacion timestamp without time zone,
    descuento_id bigint,
    CONSTRAINT chk_fg_descom_descuento_ref CHECK (((descuento_id IS NOT NULL) OR (descuento_cliente_id IS NOT NULL))),
    CONSTRAINT chk_fg_descom_estado CHECK (((estado)::text = ANY ((ARRAY['RESERVADO'::character varying, 'APLICADO'::character varying, 'LIBERADO'::character varying, 'ANULADO'::character varying])::text[]))),
    CONSTRAINT chk_fg_descom_importes CHECK (((importe_original >= importe_descuento) AND (importe_final = (importe_original - importe_descuento)) AND (importe_final >= (0)::numeric)))
);



--
-- Name: fg_descuentocomprobante_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.fg_descuentocomprobante_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: fg_descuentocomprobante_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.fg_descuentocomprobante_id_seq OWNED BY public.fg_descuentocomprobante.id;


--
-- Name: fg_descuentodetalle; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.fg_descuentodetalle (
    id bigint NOT NULL,
    descuento_id bigint NOT NULL,
    servicio_id integer NOT NULL,
    tipo_calculo character varying,
    valor numeric(14,2),
    precio_minimo numeric(14,2),
    activo boolean DEFAULT true NOT NULL,
    usuario_creacion character varying NOT NULL,
    fecha_creacion timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    usuario_modificacion character varying,
    fecha_modificacion timestamp without time zone,
    descuento_cliente_id bigint,
    planta_key character varying,
    valor_contado numeric(14,2),
    valor_credito numeric(14,2),
    CONSTRAINT chk_fg_descuentodetalle_precio_min CHECK (((precio_minimo IS NULL) OR (precio_minimo >= (0)::numeric))),
    CONSTRAINT chk_fg_descuentodetalle_regla_compartida CHECK (((descuento_cliente_id IS NOT NULL) OR ((planta_key IS NOT NULL) AND ((tipo_calculo)::text = ANY ((ARRAY['FLAT'::character varying, 'MONTO'::character varying, 'PORCENTAJE'::character varying])::text[])) AND ((((tipo_calculo)::text = 'FLAT'::text) AND (valor IS NULL) AND ((valor_contado IS NOT NULL) OR (valor_credito IS NOT NULL)) AND ((valor_contado IS NULL) OR (valor_contado > (0)::numeric)) AND ((valor_credito IS NULL) OR (valor_credito > (0)::numeric))) OR (((tipo_calculo)::text = 'MONTO'::text) AND (valor > (0)::numeric) AND (valor_contado IS NULL) AND (valor_credito IS NULL)) OR (((tipo_calculo)::text = 'PORCENTAJE'::text) AND (valor > (0)::numeric) AND (valor <= (100)::numeric) AND (valor_contado IS NULL) AND (valor_credito IS NULL)))))),
    CONSTRAINT chk_fg_descuentodetalle_valor CHECK (((valor IS NULL) OR (valor > (0)::numeric)))
);



--



--
-- Name: fg_descuentodetalle_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.fg_descuentodetalle_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: fg_descuentodetalle_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.fg_descuentodetalle_id_seq OWNED BY public.fg_descuentodetalle.id;


--
-- Name: fg_documento_anulacion; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.fg_documento_anulacion (
    id bigint NOT NULL,
    facturacion_id bigint,
    credito_id bigint,
    debito_id bigint,
    motivo character varying(100) NOT NULL,
    codigo_unico character varying(20) NOT NULL,
    estado character varying(20) DEFAULT 'BORRADOR'::character varying NOT NULL,
    ticket_sunat character varying(250),
    aceptada_sunat boolean,
    sunat_description text,
    sunat_responsecode character varying(50),
    sunat_soap_error text,
    enlace_pdf text,
    enlace_xml text,
    enlace_cdr text,
    respuesta_proveedor jsonb,
    intentos integer DEFAULT 0 NOT NULL,
    fecha_ultimo_intento timestamp without time zone,
    fecha_aceptacion timestamp without time zone,
    usuario_creacion character varying(255) NOT NULL,
    fecha_creacion timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    usuario_modificacion character varying(255),
    fecha_modificacion timestamp without time zone,
    CONSTRAINT ck_fg_anulacion_codigo CHECK (((btrim((codigo_unico)::text) <> ''::text) AND (char_length((codigo_unico)::text) <= 20))),
    CONSTRAINT ck_fg_anulacion_documento CHECK ((num_nonnulls(facturacion_id, credito_id, debito_id) = 1)),
    CONSTRAINT ck_fg_anulacion_estado CHECK (((estado)::text = ANY ((ARRAY['BORRADOR'::character varying, 'PENDIENTE'::character varying, 'ACEPTADO'::character varying, 'RECHAZADO'::character varying, 'ERROR'::character varying])::text[]))),
    CONSTRAINT ck_fg_anulacion_motivo CHECK ((btrim((motivo)::text) <> ''::text))
);



--
-- Name: fg_documento_anulacion_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.fg_documento_anulacion ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.fg_documento_anulacion_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: fg_documento_electronico_operacion; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.fg_documento_electronico_operacion (
    id bigint NOT NULL,
    facturacion_id bigint,
    credito_id bigint,
    debito_id bigint,
    anulacion_id bigint,
    operacion character varying(30) NOT NULL,
    numero_intento integer NOT NULL,
    estado character varying(20) NOT NULL,
    solicitud jsonb NOT NULL,
    respuesta jsonb,
    http_status integer,
    error text,
    usuario_creacion character varying(255) NOT NULL,
    fecha_creacion timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    fecha_finalizacion timestamp without time zone,
    CONSTRAINT ck_fg_doc_operacion_documento CHECK ((num_nonnulls(facturacion_id, credito_id, debito_id, anulacion_id) = 1)),
    CONSTRAINT ck_fg_doc_operacion_estado CHECK (((estado)::text = ANY ((ARRAY['PENDIENTE'::character varying, 'ACEPTADO'::character varying, 'PROCESANDO'::character varying, 'RECHAZADO'::character varying, 'ERROR'::character varying])::text[]))),
    CONSTRAINT ck_fg_doc_operacion_intento CHECK ((numero_intento > 0)),
    CONSTRAINT ck_fg_doc_operacion_tipo CHECK (((operacion)::text = ANY ((ARRAY['EMITIR'::character varying, 'CONSULTAR'::character varying, 'ANULAR'::character varying, 'CONSULTAR_ANULACION'::character varying])::text[])))
);



--
-- Name: fg_documento_electronico_operacion_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.fg_documento_electronico_operacion ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.fg_documento_electronico_operacion_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: fg_ejecutivo; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.fg_ejecutivo (
    id bigint NOT NULL,
    username character varying(255),
    nombre character varying(200) NOT NULL,
    activo boolean DEFAULT true NOT NULL,
    usuario_creacion character varying(255) NOT NULL,
    fecha_creacion timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    usuario_modificacion character varying(255),
    fecha_modificacion timestamp without time zone,
    CONSTRAINT ck_fg_ejecutivo_nombre CHECK ((btrim((nombre)::text) <> ''::text))
);



--
-- Name: TABLE fg_ejecutivo; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.fg_ejecutivo IS 'Catálogo de colaboradores responsables de alianzas FAREGAS';


--
-- Name: fg_ejecutivo_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.fg_ejecutivo_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: fg_ejecutivo_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.fg_ejecutivo_id_seq OWNED BY public.fg_ejecutivo.id;


--
-- Name: fg_empresa; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.fg_empresa (
    key character varying NOT NULL,
    nombre character varying NOT NULL,
    ruc character varying,
    direccion character varying,
    telefono character varying,
    cuenta_banco_nacion character varying,
    activo boolean DEFAULT true NOT NULL,
    fecha_creacion timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    fecha_modificacion timestamp without time zone,
    CONSTRAINT chk_fg_empresa_key CHECK ((btrim((key)::text) <> ''::text)),
    CONSTRAINT chk_fg_empresa_nombre CHECK ((btrim((nombre)::text) <> ''::text)),
    CONSTRAINT chk_fg_empresa_ruc CHECK (((ruc IS NULL) OR ((ruc)::text ~ '^[0-9]{11}$'::text)))
);



--
-- Name: fg_empresa_facturador; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.fg_empresa_facturador (
    id bigint NOT NULL,
    empresa_key character varying NOT NULL,
    proveedor character varying(30) DEFAULT 'NUBEFACT'::character varying NOT NULL,
    entorno character varying(20) DEFAULT 'DEMO'::character varying NOT NULL,
    credencial_clave character varying(80) NOT NULL,
    activo boolean DEFAULT true NOT NULL,
    fecha_creacion timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    fecha_modificacion timestamp without time zone,
    CONSTRAINT ck_fg_empresa_facturador_credencial CHECK (((credencial_clave)::text ~ '^[A-Z0-9_]+$'::text)),
    CONSTRAINT ck_fg_empresa_facturador_entorno CHECK (((entorno)::text = ANY ((ARRAY['DEMO'::character varying, 'PRODUCCION'::character varying])::text[]))),
    CONSTRAINT ck_fg_empresa_facturador_proveedor CHECK (((proveedor)::text = 'NUBEFACT'::text))
);



--
-- Name: COLUMN fg_empresa_facturador.credencial_clave; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.fg_empresa_facturador.credencial_clave IS 'Identificador de variables de entorno; nunca contiene ruta ni token.';


--
-- Name: fg_empresa_facturador_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.fg_empresa_facturador ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.fg_empresa_facturador_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: fg_facturacion; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.fg_facturacion (
    id bigint NOT NULL,
    certificado_id bigint,
    tipo_comprobante character varying(10) NOT NULL,
    tipo_documento_cliente character varying(20) NOT NULL,
    nro_documento character varying(20) NOT NULL,
    nombre_razon_social character varying(250) NOT NULL,
    direccion character varying(500) NOT NULL,
    email character varying(150),
    telefono character varying(30),
    moneda_key character varying(20) DEFAULT 'sol'::character varying NOT NULL,
    base_imponible numeric(14,2) NOT NULL,
    igv numeric(14,2) NOT NULL,
    importe_total numeric(14,2) NOT NULL,
    estado character varying(20) DEFAULT 'BORRADOR'::character varying NOT NULL,
    serie character varying(20),
    numero bigint,
    nro_comprobante character varying(50),
    proveedor character varying(30) DEFAULT 'NUBEFACT'::character varying NOT NULL,
    aceptada_sunat boolean,
    sunat_description text,
    sunat_responsecode character varying(50),
    sunat_soap_error text,
    enlace_pdf text,
    enlace_xml text,
    enlace_cdr text,
    cadena_qr text,
    codigo_hash text,
    respuesta_proveedor jsonb,
    intentos integer DEFAULT 0 NOT NULL,
    fecha_ultimo_intento timestamp without time zone,
    fecha_aceptacion timestamp without time zone,
    usuario_creacion character varying(255) NOT NULL,
    fecha_creacion timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    usuario_modificacion character varying(255),
    fecha_modificacion timestamp without time zone,
    operacion_id bigint,
    planta_key character varying,
    empresa_key character varying,
    ruc_emisor character varying(11),
    razon_social_emisor character varying(250),
    direccion_emisor character varying(500),
    entorno_facturador character varying(20),
    codigo_unico character varying(20),
    condicion_pago character varying(10) DEFAULT 'CONTADO'::character varying NOT NULL,
    fecha_vencimiento date,
    medio_pago character varying(250),
    serie_comprobante_id bigint,
    fecha_reserva_correlativo timestamp without time zone,
    venta_id bigint,
    fecha_documento date,
    sede_nombre_snapshot character varying(150),
    sede_direccion_snapshot character varying(500),
    sede_telefono_snapshot character varying(255),
    sede_correo_snapshot character varying(255),
    codigo_descuento_snapshot character varying(120),
    enlace_pdf_faregas text,
    facturar_al_dueno_principal boolean,
    fecha_hora_emision timestamp with time zone,
    sujeto_detraccion boolean,
    detraccion_codigo character varying(10),
    detraccion_descripcion character varying(255),
    detraccion_porcentaje numeric(5,2),
    detraccion_base numeric(12,2),
    detraccion_monto numeric(12,2),
    detraccion_neto numeric(12,2),
    detraccion_estado_deposito character varying(30),
    detraccion_constancia_nro character varying(50),
    detraccion_constancia_fecha date,
    detraccion_motivo_exclusion character varying(150),
    CONSTRAINT ck_fg_facturacion_codigo_unico CHECK (((codigo_unico IS NULL) OR ((btrim((codigo_unico)::text) <> ''::text) AND (char_length((codigo_unico)::text) <= 20)))),
    CONSTRAINT ck_fg_facturacion_condicion_pago CHECK (((condicion_pago)::text = ANY ((ARRAY['CONTADO'::character varying, 'CREDITO'::character varying])::text[]))),
    CONSTRAINT ck_fg_facturacion_documento CHECK (((tipo_documento_cliente)::text = ANY ((ARRAY['DNI'::character varying, 'RUC'::character varying, 'CARNETEXTRANJERIA'::character varying])::text[]))),
    CONSTRAINT ck_fg_facturacion_entorno CHECK (((entorno_facturador IS NULL) OR ((entorno_facturador)::text = ANY ((ARRAY['DEMO'::character varying, 'PRODUCCION'::character varying])::text[])))),
    CONSTRAINT ck_fg_facturacion_importes CHECK (((base_imponible >= (0)::numeric) AND (igv >= (0)::numeric) AND (importe_total >= (0)::numeric))),
    CONSTRAINT ck_fg_facturacion_ruc_emisor CHECK (((ruc_emisor IS NULL) OR ((ruc_emisor)::text ~ '^[0-9]{11}$'::text))),
    CONSTRAINT ck_fg_facturacion_tipo CHECK (((tipo_comprobante)::text = ANY ((ARRAY['BOLETA'::character varying, 'FACTURA'::character varying])::text[]))),
    CONSTRAINT fg_facturacion_estado_check CHECK (((estado)::text = ANY ((ARRAY['BORRADOR'::character varying, 'PENDIENTE'::character varying, 'PENDIENTE_SUNAT'::character varying, 'ACEPTADO'::character varying, 'RECHAZADO'::character varying, 'ERROR'::character varying, 'ANULADO'::character varying])::text[])))
);



--
-- Name: COLUMN fg_facturacion.codigo_unico; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.fg_facturacion.codigo_unico IS 'Idempotencia Nubefact estable para todos los reintentos de una facturacion.';


--
-- Name: COLUMN fg_facturacion.fecha_hora_emision; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.fg_facturacion.fecha_hora_emision IS 'Instante local de generación del comprobante (registro creado). NULL=sin registro.';


--
-- Name: fg_facturacion_cuota; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.fg_facturacion_cuota (
    id bigint NOT NULL,
    facturacion_id bigint NOT NULL,
    numero_cuota integer NOT NULL,
    fecha_pago date NOT NULL,
    importe numeric(14,2) NOT NULL,
    estado character varying(20) DEFAULT 'PENDIENTE'::character varying NOT NULL,
    fecha_creacion timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    fecha_modificacion timestamp without time zone,
    CONSTRAINT ck_fg_facturacion_cuota_estado CHECK (((estado)::text = ANY ((ARRAY['PENDIENTE'::character varying, 'PAGADA'::character varying, 'ANULADA'::character varying])::text[]))),
    CONSTRAINT ck_fg_facturacion_cuota_importe CHECK ((importe > (0)::numeric)),
    CONSTRAINT ck_fg_facturacion_cuota_numero CHECK ((numero_cuota > 0))
);



--
-- Name: fg_facturacion_cuota_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.fg_facturacion_cuota ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.fg_facturacion_cuota_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: fg_facturacion_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.fg_facturacion ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.fg_facturacion_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: fg_facturacion_intento; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.fg_facturacion_intento (
    id bigint NOT NULL,
    facturacion_id bigint NOT NULL,
    numero_intento integer NOT NULL,
    estado character varying(20) NOT NULL,
    solicitud jsonb NOT NULL,
    respuesta jsonb,
    http_status integer,
    error text,
    fecha_creacion timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    fecha_finalizacion timestamp without time zone,
    CONSTRAINT ck_fg_facturacion_intento_estado CHECK (((estado)::text = ANY (ARRAY[('PENDIENTE'::character varying)::text, ('ACEPTADO'::character varying)::text, ('RECHAZADO'::character varying)::text, ('ERROR'::character varying)::text, ('PENDIENTE_SUNAT'::character varying)::text])))
);



--
-- Name: fg_facturacion_intento_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.fg_facturacion_intento ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.fg_facturacion_intento_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: fg_inventario_cantidad_movimiento; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.fg_inventario_cantidad_movimiento (
    id bigint NOT NULL,
    producto_inventariable_id bigint NOT NULL,
    planta_key character varying NOT NULL,
    tipo_movimiento character varying(20) NOT NULL,
    sentido character varying(10) NOT NULL,
    cantidad numeric(12,3) NOT NULL,
    operacion_detalle_id bigint,
    usuario character varying NOT NULL,
    referencia character varying(250),
    detalles jsonb DEFAULT '{}'::jsonb NOT NULL,
    fecha_creacion timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT fg_inventario_cantidad_movimiento_cantidad_check CHECK ((cantidad > (0)::numeric)),
    CONSTRAINT fg_inventario_cantidad_movimiento_sentido_check CHECK (((sentido)::text = ANY ((ARRAY['ENTRADA'::character varying, 'SALIDA'::character varying])::text[]))),
    CONSTRAINT fg_inventario_cantidad_movimiento_tipo_movimiento_check CHECK (((tipo_movimiento)::text = ANY ((ARRAY['INGRESO'::character varying, 'VENTA'::character varying, 'AJUSTE'::character varying, 'DEVOLUCION'::character varying])::text[]))),
    CONSTRAINT fg_inventario_cantidad_movimiento_tipo_sentido_ck CHECK (((((tipo_movimiento)::text = ANY ((ARRAY['INGRESO'::character varying, 'DEVOLUCION'::character varying])::text[])) AND ((sentido)::text = 'ENTRADA'::text)) OR (((tipo_movimiento)::text = 'VENTA'::text) AND ((sentido)::text = 'SALIDA'::text)) OR ((tipo_movimiento)::text = 'AJUSTE'::text)))
);



--
-- Name: fg_inventario_cantidad_movimiento_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.fg_inventario_cantidad_movimiento ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.fg_inventario_cantidad_movimiento_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: fg_nota_credito_trabajo; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.fg_nota_credito_trabajo (
    id bigint NOT NULL,
    solicitud_id bigint NOT NULL,
    certificado_id bigint NOT NULL,
    facturacion_id bigint NOT NULL,
    credito_id bigint,
    empresa_key character varying(40) NOT NULL,
    planta_key character varying(40) NOT NULL,
    motivo_codigo character varying(2) NOT NULL,
    sustento_aprobado text NOT NULL,
    datos_aprobados jsonb DEFAULT '{}'::jsonb NOT NULL,
    estado character varying(30) DEFAULT 'EN_COLA'::character varying NOT NULL,
    intentos integer DEFAULT 0 NOT NULL,
    disponible_desde timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    propietario_bloqueo uuid,
    bloqueo_hasta timestamp with time zone,
    usuario_ejecutor character varying(255) NOT NULL,
    ultimo_error_codigo character varying(100),
    ultimo_error_mensaje text,
    resultado jsonb,
    fecha_creacion timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    fecha_modificacion timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    fecha_inicio timestamp with time zone,
    fecha_finalizacion timestamp with time zone,
    CONSTRAINT ck_fg_nota_credito_trabajo_estado CHECK (((estado)::text = ANY ((ARRAY['EN_COLA'::character varying, 'ESPERANDO_COMPROBANTE'::character varying, 'EMITIENDO'::character varying, 'PENDIENTE_SUNAT'::character varying, 'ACEPTADA'::character varying, 'RECHAZADA'::character varying, 'BLOQUEADA'::character varying, 'RESULTADO_INCIERTO'::character varying, 'ERROR'::character varying])::text[]))),
    CONSTRAINT ck_fg_nota_credito_trabajo_intentos CHECK ((intentos >= 0)),
    CONSTRAINT ck_fg_nota_credito_trabajo_motivo CHECK (((motivo_codigo)::text = ANY ((ARRAY['01'::character varying, '02'::character varying, '03'::character varying])::text[])))
);



--
-- Name: fg_nota_credito_trabajo_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.fg_nota_credito_trabajo ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.fg_nota_credito_trabajo_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: fg_notificacion; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.fg_notificacion (
    id bigint NOT NULL,
    evento_clave character varying(80) NOT NULL,
    tipo character varying(40) NOT NULL,
    titulo character varying(160) NOT NULL,
    mensaje character varying(500) NOT NULL,
    planta_key character varying(80),
    empresa_key character varying(80),
    entidad_tipo character varying(60),
    entidad_id bigint,
    destino_navegacion character varying(200),
    fecha_creacion timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    creado_por character varying(80)
);



--
-- Name: fg_notificacion_destinatario; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.fg_notificacion_destinatario (
    id bigint NOT NULL,
    notificacion_id bigint NOT NULL,
    usuario_id character varying(80) NOT NULL,
    leida boolean DEFAULT false NOT NULL,
    fecha_lectura timestamp with time zone
);



--
-- Name: fg_notificacion_destinatario_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.fg_notificacion_destinatario_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: fg_notificacion_destinatario_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.fg_notificacion_destinatario_id_seq OWNED BY public.fg_notificacion_destinatario.id;


--
-- Name: fg_notificacion_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.fg_notificacion_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: fg_notificacion_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.fg_notificacion_id_seq OWNED BY public.fg_notificacion.id;


--
-- Name: fg_operacion_comercial; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.fg_operacion_comercial (
    id bigint NOT NULL,
    planta_key character varying NOT NULL,
    cliente_id bigint,
    tipo_documento_cliente_snapshot character varying(20),
    documento_cliente_snapshot character varying(20),
    nombre_cliente_snapshot character varying(250),
    direccion_cliente_snapshot character varying(500),
    placa character varying(12),
    moneda_key character varying DEFAULT 'sol'::character varying NOT NULL,
    base_imponible numeric(14,2) DEFAULT 0 NOT NULL,
    igv numeric(14,2) DEFAULT 0 NOT NULL,
    importe_total numeric(14,2) DEFAULT 0 NOT NULL,
    estado character varying(30) DEFAULT 'BORRADOR'::character varying NOT NULL,
    usuario_creacion character varying NOT NULL,
    fecha_creacion timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    usuario_modificacion character varying,
    fecha_modificacion timestamp without time zone,
    CONSTRAINT ck_fg_operacion_estado CHECK (((estado)::text = ANY ((ARRAY['BORRADOR'::character varying, 'PENDIENTE_PAGO'::character varying, 'PAGADO'::character varying, 'FACTURADO'::character varying, 'ANULADO'::character varying])::text[]))),
    CONSTRAINT ck_fg_operacion_importes CHECK (((base_imponible >= (0)::numeric) AND (igv >= (0)::numeric) AND (importe_total >= (0)::numeric))),
    CONSTRAINT ck_fg_operacion_placa CHECK (((placa IS NULL) OR (btrim((placa)::text) <> ''::text)))
);



--
-- Name: fg_operacion_comercial_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.fg_operacion_comercial_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: fg_operacion_comercial_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.fg_operacion_comercial_id_seq OWNED BY public.fg_operacion_comercial.id;


--
-- Name: fg_operacion_detalle; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.fg_operacion_detalle (
    id bigint NOT NULL,
    operacion_id bigint NOT NULL,
    tipo_item character varying(20) NOT NULL,
    servicio_id integer,
    tarifa_id integer,
    producto_facturacion_id bigint,
    certificado_id bigint,
    cantidad numeric(12,3) NOT NULL,
    codigo_sku_snapshot character varying(80),
    descripcion_snapshot character varying(500) NOT NULL,
    unidad_snapshot character varying(30) NOT NULL,
    afectacion_igv_snapshot character varying(2) NOT NULL,
    codigo_sunat_snapshot character varying(30),
    valor_unitario numeric(14,6) NOT NULL,
    precio_unitario numeric(14,6) NOT NULL,
    base_imponible numeric(14,2) NOT NULL,
    igv numeric(14,2) NOT NULL,
    importe_total numeric(14,2) NOT NULL,
    genera_certificado_snapshot boolean DEFAULT false NOT NULL,
    orden integer NOT NULL,
    fecha_creacion timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT ck_fg_operacion_detalle_cantidad CHECK ((cantidad > (0)::numeric)),
    CONSTRAINT ck_fg_operacion_detalle_concepto CHECK (((((tipo_item)::text = 'PRODUCTO'::text) AND (servicio_id IS NULL) AND (tarifa_id IS NULL) AND (certificado_id IS NULL) AND (genera_certificado_snapshot = false) AND ((producto_facturacion_id IS NOT NULL) OR ((producto_facturacion_id IS NULL) AND (codigo_sku_snapshot IS NOT NULL) AND (descripcion_snapshot IS NOT NULL) AND (unidad_snapshot IS NOT NULL) AND (afectacion_igv_snapshot IS NOT NULL) AND (valor_unitario IS NOT NULL) AND (precio_unitario IS NOT NULL) AND (base_imponible IS NOT NULL) AND (igv IS NOT NULL) AND (importe_total IS NOT NULL)))) OR (((tipo_item)::text = 'SERVICIO'::text) AND (servicio_id IS NOT NULL) AND ((tarifa_id IS NOT NULL) OR ((tarifa_id IS NULL) AND (codigo_sku_snapshot IS NOT NULL) AND (descripcion_snapshot IS NOT NULL) AND (unidad_snapshot IS NOT NULL) AND (afectacion_igv_snapshot IS NOT NULL) AND (valor_unitario IS NOT NULL) AND (precio_unitario IS NOT NULL) AND (base_imponible IS NOT NULL) AND (igv IS NOT NULL) AND (importe_total IS NOT NULL))) AND (((genera_certificado_snapshot = true) AND (certificado_id IS NOT NULL)) OR ((genera_certificado_snapshot = false) AND (certificado_id IS NULL)))))),
    CONSTRAINT ck_fg_operacion_detalle_importes CHECK (((valor_unitario >= (0)::numeric) AND (precio_unitario >= (0)::numeric) AND (base_imponible >= (0)::numeric) AND (igv >= (0)::numeric) AND (importe_total >= (0)::numeric))),
    CONSTRAINT ck_fg_operacion_detalle_orden CHECK ((orden > 0)),
    CONSTRAINT ck_fg_operacion_detalle_tipo CHECK (((tipo_item)::text = ANY ((ARRAY['SERVICIO'::character varying, 'PRODUCTO'::character varying])::text[])))
);



--
-- Name: fg_operacion_detalle_chip; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.fg_operacion_detalle_chip (
    operacion_detalle_id bigint NOT NULL,
    chip_id bigint NOT NULL
);



--
-- Name: fg_operacion_detalle_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.fg_operacion_detalle_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: fg_operacion_detalle_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.fg_operacion_detalle_id_seq OWNED BY public.fg_operacion_detalle.id;


--
-- Name: fg_orden_pago; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.fg_orden_pago (
    id bigint NOT NULL,
    certificado_id bigint,
    importe_total double precision NOT NULL,
    baseimponible double precision NOT NULL,
    igv double precision NOT NULL,
    importe_pagado double precision DEFAULT 0 NOT NULL,
    saldo_pendiente double precision NOT NULL,
    moneda_key character varying(20) DEFAULT 'sol'::character varying NOT NULL,
    formapago_key character varying(20) DEFAULT 'contado'::character varying NOT NULL,
    estado character varying(255) DEFAULT 'PENDIENTE'::character varying NOT NULL,
    fechacreacion timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    fechmodi timestamp without time zone,
    usuariocreacion_username character varying(255) NOT NULL,
    usuariomodi_username character varying(255),
    operacion_id bigint,
    venta_id bigint,
    fecha_inicio_credito date,
    fecha_vencimiento_credito date,
    CONSTRAINT chk_fg_orden_pago_estado CHECK (((estado)::text = ANY ((ARRAY['PENDIENTE'::character varying, 'PAGADO'::character varying, 'ANULADO'::character varying])::text[]))),
    CONSTRAINT chk_fg_orden_pago_importe_pagado CHECK ((importe_pagado >= (0)::double precision)),
    CONSTRAINT chk_fg_orden_pago_periodo_credito CHECK (((fecha_inicio_credito IS NULL) OR (fecha_vencimiento_credito IS NULL) OR (fecha_vencimiento_credito >= fecha_inicio_credito))),
    CONSTRAINT chk_fg_orden_pago_saldo CHECK ((saldo_pendiente >= (0)::double precision)),
    CONSTRAINT chk_fg_orden_pago_total CHECK ((importe_total >= (0)::double precision))
);



--
-- Name: COLUMN fg_orden_pago.fecha_inicio_credito; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.fg_orden_pago.fecha_inicio_credito IS 'Fecha inicial del período de crédito capturada en el paso Pago.';


--
-- Name: COLUMN fg_orden_pago.fecha_vencimiento_credito; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.fg_orden_pago.fecha_vencimiento_credito IS 'Fecha final del período de crédito capturada en el paso Pago.';


--
-- Name: fg_orden_pago_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.fg_orden_pago ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.fg_orden_pago_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: fg_pago; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.fg_pago (
    id bigint NOT NULL,
    baseimponible double precision,
    digitotarjeta character varying(4),
    estado character varying(255),
    fechacreacion timestamp without time zone,
    fechdeposito timestamp without time zone,
    igv double precision,
    importe double precision,
    nrooperacionbanco character varying(75),
    nrooperaciontarjeta character varying(75),
    sendedtooffisis boolean,
    orden_pago_id bigint,
    cuentacorriente_key character varying(20),
    entidadfinanciera_key character varying(20),
    moneda_key character varying(20),
    tarjeta_key character varying(20),
    tipocontado_key character varying(20),
    modalidad_tarjeta character varying(10),
    CONSTRAINT chk_fg_pago_digitos CHECK (((digitotarjeta IS NULL) OR ((digitotarjeta)::text ~ '^[0-9]{4}$'::text))),
    CONSTRAINT chk_fg_pago_importe CHECK ((importe > (0)::double precision)),
    CONSTRAINT chk_fg_pago_modalidad_tarjeta CHECK (((modalidad_tarjeta IS NULL) OR ((modalidad_tarjeta)::text = ANY ((ARRAY['DEBITO'::character varying, 'CREDITO'::character varying])::text[]))))
);



--
-- Name: fg_pago_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.fg_pago ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.fg_pago_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: fg_perfil; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.fg_perfil (
    clave character varying(255) NOT NULL,
    nombre character varying(255) NOT NULL,
    visible boolean
);



--
-- Name: fg_perfil_permiso; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.fg_perfil_permiso (
    perfil_clave character varying(255) NOT NULL,
    permiso_clave character varying(100) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);



--
-- Name: fg_perfil_planta; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.fg_perfil_planta (
    perfil_clave character varying(255) NOT NULL,
    planta_key character varying(20) NOT NULL
);



--
-- Name: fg_permiso; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.fg_permiso (
    clave character varying(100) NOT NULL,
    nombre character varying(200) NOT NULL,
    modulo character varying(100) NOT NULL,
    descripcion text,
    activo boolean DEFAULT true NOT NULL
);



--
-- Name: fg_planta; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.fg_planta (
    key character varying(20) NOT NULL,
    nombre character varying(150) NOT NULL,
    direccion character varying(500),
    telefono character varying(255),
    activo boolean DEFAULT true NOT NULL,
    empresa_key character varying NOT NULL,
    correo character varying(255)
);



--
-- Name: fg_producto_facturacion; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.fg_producto_facturacion (
    id bigint NOT NULL,
    codigo_sku character varying(120) NOT NULL,
    descripcion character varying(300) NOT NULL,
    tipo_producto character varying(50),
    categoria_dms character varying(200),
    cuenta_por_cobrar character varying(200),
    unidad character varying(20),
    precio_unitario numeric(14,4),
    precio_referencia numeric(14,4),
    valor_referencial_unitario numeric(14,4),
    codigo_clasificacion_sunat character varying(30),
    tipo_afectacion_igv character varying(10),
    porcentaje_isc numeric(8,4),
    disponible_pos boolean DEFAULT false NOT NULL,
    es_para_venta boolean DEFAULT true NOT NULL,
    es_para_compra boolean DEFAULT false NOT NULL,
    tiene_icbper boolean DEFAULT false NOT NULL,
    activo boolean DEFAULT true NOT NULL,
    fecha_creacion timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    fecha_modificacion timestamp without time zone,
    categoria_id integer,
    requiere_chip boolean DEFAULT false NOT NULL,
    producto_chip_id bigint,
    precio_chip numeric(12,2),
    codigo_barras character varying(120),
    codigo_afectacion_isc character varying(20),
    imagen_url text,
    sujeto_detraccion boolean,
    detraccion_codigo character varying(10),
    detraccion_porcentaje numeric(5,2),
    naturaleza_spot character varying(20),
    CONSTRAINT chk_fg_producto_facturacion_naturaleza_spot CHECK (((naturaleza_spot IS NULL) OR ((naturaleza_spot)::text = ANY ((ARRAY['BIEN'::character varying, 'SERVICIO'::character varying])::text[])))),
    CONSTRAINT chk_fg_producto_facturacion_afectacion CHECK (((tipo_afectacion_igv IS NULL) OR ((tipo_afectacion_igv)::text ~ '^[0-9]{2}$'::text))),
    CONSTRAINT chk_fg_producto_facturacion_descripcion CHECK ((btrim((descripcion)::text) <> ''::text)),
    CONSTRAINT chk_fg_producto_facturacion_porcentaje_isc CHECK (((porcentaje_isc IS NULL) OR (porcentaje_isc >= (0)::numeric))),
    CONSTRAINT chk_fg_producto_facturacion_precio_referencia CHECK (((precio_referencia IS NULL) OR (precio_referencia >= (0)::numeric))),
    CONSTRAINT chk_fg_producto_facturacion_precio_unitario CHECK (((precio_unitario IS NULL) OR (precio_unitario >= (0)::numeric))),
    CONSTRAINT chk_fg_producto_facturacion_sku CHECK ((btrim((codigo_sku)::text) <> ''::text)),
    CONSTRAINT chk_fg_producto_facturacion_valor_referencial CHECK (((valor_referencial_unitario IS NULL) OR (valor_referencial_unitario >= (0)::numeric))),
    CONSTRAINT ck_fg_producto_facturacion_chip CHECK ((((requiere_chip = true) AND (producto_chip_id IS NOT NULL)) OR ((requiere_chip = false) AND (producto_chip_id IS NULL)))),
    CONSTRAINT ck_fg_producto_facturacion_precio_chip CHECK (((precio_chip IS NULL) OR (precio_chip >= (0)::numeric)))
);



--
-- Name: COLUMN fg_producto_facturacion.precio_referencia; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.fg_producto_facturacion.precio_referencia IS 'Precio de venta unitario del maestro comercial; no reemplaza la tarifa por sede.';


--
-- Name: COLUMN fg_producto_facturacion.categoria_id; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.fg_producto_facturacion.categoria_id IS 'Categoría funcional principal del producto fiscal. Puede ser NULL solo para datos históricos pendientes de clasificación.';


--
-- Name: COLUMN fg_producto_facturacion.codigo_barras; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.fg_producto_facturacion.codigo_barras IS 'Código de barras opcional proveniente del maestro comercial DMS.';


--
-- Name: COLUMN fg_producto_facturacion.codigo_afectacion_isc; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.fg_producto_facturacion.codigo_afectacion_isc IS 'Código de afectación ISC opcional del maestro fiscal DMS.';


--
-- Name: COLUMN fg_producto_facturacion.imagen_url; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.fg_producto_facturacion.imagen_url IS 'URL opcional de la imagen del producto; no almacena binarios.';


--
-- Name: fg_producto_facturacion_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.fg_producto_facturacion ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.fg_producto_facturacion_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: fg_producto_inventariable; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.fg_producto_inventariable (
    id bigint NOT NULL,
    codigo character varying(60) NOT NULL,
    nombre character varying(200) NOT NULL,
    producto_facturacion_id bigint,
    control_stock boolean DEFAULT true NOT NULL,
    activo boolean DEFAULT true NOT NULL,
    fecha_creacion timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    fecha_modificacion timestamp without time zone,
    tipo character varying(100) DEFAULT 'OTRO_PRODUCTO_FISICO'::character varying NOT NULL,
    codigo_autogenerable boolean DEFAULT false NOT NULL,
    CONSTRAINT ck_fg_producto_inventariable_codigo CHECK ((btrim((codigo)::text) <> ''::text)),
    CONSTRAINT ck_fg_producto_inventariable_nombre CHECK ((btrim((nombre)::text) <> ''::text))
);



--
-- Name: fg_chip_codigo_reserva; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.fg_chip_codigo_reserva (
    id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    token uuid NOT NULL,
    numero_chip character varying(120) NOT NULL,
    producto_inventariable_id bigint NOT NULL,
    planta_key character varying NOT NULL,
    creado_por character varying NOT NULL,
    creado_en timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    vence_en timestamp with time zone NOT NULL,
    CONSTRAINT uq_fg_chip_codigo_reserva_numero UNIQUE (numero_chip),
    CONSTRAINT ck_fg_chip_codigo_reserva_no_vacio CHECK ((btrim((numero_chip)::text) <> ''::text))
);

CREATE INDEX idx_fg_chip_codigo_reserva_token
    ON public.fg_chip_codigo_reserva USING btree (token);

CREATE INDEX idx_fg_chip_codigo_reserva_vencimiento
    ON public.fg_chip_codigo_reserva USING btree (vence_en);


-- Name: fg_producto_inventariable_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.fg_producto_inventariable ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.fg_producto_inventariable_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: fg_producto_inventariable_sede; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.fg_producto_inventariable_sede (
    id bigint NOT NULL,
    producto_inventariable_id bigint NOT NULL,
    planta_key character varying NOT NULL,
    precio numeric(14,2) NOT NULL,
    activo boolean DEFAULT true NOT NULL,
    fecha_creacion timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    fecha_modificacion timestamp without time zone,
    stock_permitido boolean DEFAULT false NOT NULL,
    venta_habilitada boolean DEFAULT false NOT NULL,
    producto_facturacion_id bigint,
    CONSTRAINT ck_fg_producto_inventariable_sede_precio CHECK ((precio > (0)::numeric))
);



--
-- Name: fg_producto_inventariable_sede_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.fg_producto_inventariable_sede ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.fg_producto_inventariable_sede_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: fg_producto_sede; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.fg_producto_sede (
    id bigint NOT NULL,
    planta_key character varying NOT NULL,
    producto_facturacion_id bigint NOT NULL,
    precio numeric(14,2) NOT NULL,
    activo boolean DEFAULT true NOT NULL,
    orden integer DEFAULT 0 NOT NULL,
    fecha_creacion timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    fecha_modificacion timestamp without time zone,
    CONSTRAINT ck_fg_producto_sede_orden CHECK ((orden >= 0)),
    CONSTRAINT ck_fg_producto_sede_precio CHECK ((precio > (0)::numeric))
);



--
-- Name: fg_producto_sede_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.fg_producto_sede_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: fg_producto_sede_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.fg_producto_sede_id_seq OWNED BY public.fg_producto_sede.id;


--
-- Name: fg_serie_comprobante; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.fg_serie_comprobante (
    id bigint NOT NULL,
    planta_key character varying(50) NOT NULL,
    tipo_comprobante character varying(30) NOT NULL,
    serie character varying(30) NOT NULL,
    ultimo_numero bigint DEFAULT 0 NOT NULL,
    es_predeterminada boolean DEFAULT false NOT NULL,
    autogenerada boolean DEFAULT true NOT NULL,
    contingencia boolean DEFAULT false NOT NULL,
    activo boolean DEFAULT true NOT NULL,
    fecha_creacion timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    fecha_modificacion timestamp without time zone,
    tipo_documento_referencia character varying(2),
    serie_pos boolean DEFAULT false NOT NULL,
    empresa_key character varying,
    proveedor_emision character varying(30) DEFAULT 'LEGACY'::character varying NOT NULL,
    entorno_emision character varying(15) DEFAULT 'DEMO'::character varying NOT NULL,
    confirmada_produccion boolean DEFAULT false NOT NULL,
    numero_inicial_confirmado bigint,
    sistema_origen character varying(30),
    fecha_corte timestamp without time zone,
    usuario_confirmacion character varying(255),
    fecha_confirmacion timestamp without time zone,
    nombre_dms character varying(30),
    codigo_local_dms character varying(10),
    nombre_local_dms character varying(80),
    telefono_local_dms character varying(30),
    correo_local_dms character varying(120),
    direccion_comercial_dms character varying(200),
    CONSTRAINT chk_fg_serie_comprobante_numero CHECK ((ultimo_numero >= 0)),
    CONSTRAINT chk_fg_serie_comprobante_serie CHECK ((btrim((serie)::text) <> ''::text)),
    CONSTRAINT chk_fg_serie_comprobante_tipo CHECK (((tipo_comprobante)::text = ANY ((ARRAY['FACTURA'::character varying, 'BOLETA'::character varying, 'NOTA_CREDITO_FACTURA'::character varying, 'NOTA_CREDITO_BOLETA'::character varying, 'NOTA_DEBITO_FACTURA'::character varying, 'NOTA_DEBITO_BOLETA'::character varying])::text[]))),
    CONSTRAINT ck_fg_serie_entorno_emision CHECK (((entorno_emision)::text = ANY ((ARRAY['DEMO'::character varying, 'PRODUCCION'::character varying])::text[]))),
    CONSTRAINT ck_fg_serie_numero_inicial_confirmado CHECK (((numero_inicial_confirmado IS NULL) OR (numero_inicial_confirmado >= 0))),
    CONSTRAINT ck_fg_serie_proveedor_emision CHECK (((proveedor_emision)::text = ANY ((ARRAY['LEGACY'::character varying, 'NUBEFACT'::character varying])::text[])))
);



--
-- Name: fg_serie_comprobante_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.fg_serie_comprobante ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.fg_serie_comprobante_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: fg_servicio; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.fg_servicio (
    id integer NOT NULL,
    codigo character varying(50) NOT NULL,
    nombre character varying(150) NOT NULL,
    familia character varying(50) NOT NULL,
    tipo_certificado_clave character varying(50),
    modalidad character varying(50),
    requiere_certificado boolean DEFAULT true NOT NULL,
    requiere_vehiculo boolean DEFAULT true NOT NULL,
    activo boolean DEFAULT true NOT NULL,
    orden integer DEFAULT 0 NOT NULL,
    categoria_id integer NOT NULL,
    tipo_flujo character varying(30) NOT NULL,
    formato_id integer,
    sujeto_detraccion boolean,
    detraccion_codigo character varying(10),
    detraccion_porcentaje numeric(5,2),
    CONSTRAINT ck_fg_servicio_tipo_flujo CHECK (((tipo_flujo)::text = ANY ((ARRAY['CERTIFICACION'::character varying, 'SERVICIO_COMPLEMENTARIO'::character varying, 'VEHICULAR_EXISTENTE'::character varying, 'TALLER_INSPECCION'::character varying, 'PRODUCTO_SOLAMENTE'::character varying])::text[])))
);



--
-- Name: fg_servicio_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.fg_servicio_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: fg_servicio_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.fg_servicio_id_seq OWNED BY public.fg_servicio.id;


--
-- Name: fg_solicitud_operacion; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.fg_solicitud_operacion (
    id bigint NOT NULL,
    tipo_operacion character varying(40) NOT NULL,
    certificado_id bigint,
    facturacion_id bigint,
    empresa_key character varying NOT NULL,
    planta_key character varying(20) NOT NULL,
    usuario_solicitante character varying(255) NOT NULL,
    motivo character varying(500) NOT NULL,
    observaciones text,
    estado character varying(40) DEFAULT 'PENDIENTE_APROBACION'::character varying NOT NULL,
    usuario_decision character varying(255),
    fecha_solicitud timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    fecha_decision timestamp with time zone,
    justificacion_decision character varying(1000),
    datos_originales_certificado jsonb,
    datos_originales_comprobante jsonb,
    datos_propuestos jsonb,
    fecha_emision_original date,
    resultado_tecnico jsonb,
    resultado_fiscal jsonb,
    idempotencia_clave uuid NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    fecha_creacion timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    fecha_modificacion timestamp with time zone,
    usuario_ejecucion character varying(255),
    fecha_ejecucion timestamp with time zone,
    idempotencia_ejecucion uuid,
    autorizacion_autoejecucion boolean DEFAULT false NOT NULL,
    CONSTRAINT ck_fg_solicitud_documentos CHECK (((((tipo_operacion)::text = ANY (ARRAY[('ANULAR_CERTIFICADO'::character varying)::text, ('RECTIFICAR_CERTIFICADO'::character varying)::text])) AND (certificado_id IS NOT NULL)) OR (((tipo_operacion)::text = ANY (ARRAY[('ANULAR_COMPROBANTE'::character varying)::text, ('RECTIFICAR_COMPROBANTE'::character varying)::text])) AND (facturacion_id IS NOT NULL)) OR (((tipo_operacion)::text = 'ANULAR_AMBOS'::text) AND (certificado_id IS NOT NULL)) OR (((tipo_operacion)::text = 'RECTIFICAR_AMBOS'::text) AND (certificado_id IS NOT NULL) AND (facturacion_id IS NOT NULL)) OR (((tipo_operacion)::text = 'EMITIR_NOTA_CREDITO'::text) AND (certificado_id IS NOT NULL) AND (facturacion_id IS NOT NULL)))),
    CONSTRAINT ck_fg_solicitud_estado CHECK (((estado)::text = ANY ((ARRAY['PENDIENTE_APROBACION'::character varying, 'APROBADA'::character varying, 'RECHAZADA'::character varying, 'CANCELADA'::character varying, 'EN_EJECUCION'::character varying, 'COMPLETADA'::character varying, 'ERROR'::character varying, 'REQUIERE_INTERVENCION'::character varying])::text[]))),
    CONSTRAINT ck_fg_solicitud_motivo CHECK ((btrim((motivo)::text) <> ''::text)),
    CONSTRAINT ck_fg_solicitud_no_autoejecucion CHECK (((usuario_ejecucion IS NULL) OR ((usuario_ejecucion)::text IS DISTINCT FROM (usuario_solicitante)::text) OR (((usuario_ejecucion)::text = (usuario_solicitante)::text) AND (autorizacion_autoejecucion = true)))),
    CONSTRAINT ck_fg_solicitud_tipo CHECK (((tipo_operacion)::text = ANY ((ARRAY['ANULAR_CERTIFICADO'::character varying, 'ANULAR_COMPROBANTE'::character varying, 'ANULAR_AMBOS'::character varying, 'EMITIR_NOTA_CREDITO'::character varying, 'RECTIFICAR_CERTIFICADO'::character varying, 'RECTIFICAR_COMPROBANTE'::character varying, 'RECTIFICAR_AMBOS'::character varying])::text[]))),
    CONSTRAINT ck_fg_solicitud_version CHECK ((version > 0))
);



--
-- Name: fg_solicitud_operacion_evento; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.fg_solicitud_operacion_evento (
    id bigint NOT NULL,
    solicitud_id bigint NOT NULL,
    tipo_evento character varying(50) NOT NULL,
    estado_anterior character varying(40),
    estado_posterior character varying(40) NOT NULL,
    usuario_responsable character varying(255) NOT NULL,
    fecha_evento timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    comentario text,
    metadatos jsonb,
    CONSTRAINT ck_fg_solicitud_evento_anterior CHECK (((estado_anterior IS NULL) OR ((estado_anterior)::text = ANY ((ARRAY['PENDIENTE_APROBACION'::character varying, 'APROBADA'::character varying, 'RECHAZADA'::character varying, 'CANCELADA'::character varying, 'EN_EJECUCION'::character varying, 'COMPLETADA'::character varying, 'ERROR'::character varying, 'REQUIERE_INTERVENCION'::character varying])::text[])))),
    CONSTRAINT ck_fg_solicitud_evento_posterior CHECK (((estado_posterior)::text = ANY ((ARRAY['PENDIENTE_APROBACION'::character varying, 'APROBADA'::character varying, 'RECHAZADA'::character varying, 'CANCELADA'::character varying, 'EN_EJECUCION'::character varying, 'COMPLETADA'::character varying, 'ERROR'::character varying, 'REQUIERE_INTERVENCION'::character varying])::text[])))
);



--
-- Name: fg_solicitud_operacion_evento_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.fg_solicitud_operacion_evento ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.fg_solicitud_operacion_evento_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: fg_solicitud_operacion_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.fg_solicitud_operacion ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.fg_solicitud_operacion_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: fg_taller_autorizado; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.fg_taller_autorizado (
    id bigint NOT NULL,
    ruc character varying(11),
    razon_social character varying(300) NOT NULL,
    nombre_comercial character varying(300),
    sede character varying(200),
    direccion character varying(500),
    codigo_autorizacion character varying(100),
    estado boolean DEFAULT true NOT NULL,
    fecha_creacion timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    fecha_modificacion timestamp without time zone,
    planta_key character varying(20)
);



--
-- Name: fg_taller_autorizado_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.fg_taller_autorizado_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: fg_taller_autorizado_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.fg_taller_autorizado_id_seq OWNED BY public.fg_taller_autorizado.id;


--
-- Name: fg_tarifa; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.fg_tarifa (
    id integer NOT NULL,
    planta_key character varying(20) NOT NULL,
    codigo character varying(50) NOT NULL,
    familia character varying(30) NOT NULL,
    nombre character varying(150) NOT NULL,
    tipo_certificado_clave character varying(50),
    modalidad character varying(20),
    precio numeric(10,2) NOT NULL,
    activo boolean DEFAULT true NOT NULL,
    orden integer DEFAULT 0 NOT NULL,
    servicio_id integer NOT NULL,
    producto_facturacion_id bigint,
    CONSTRAINT chk_fg_tarifa_precio_positivo CHECK ((precio > (0)::numeric))
);



--
-- Name: fg_tarifa_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.fg_tarifa_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: fg_tarifa_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.fg_tarifa_id_seq OWNED BY public.fg_tarifa.id;


--
-- Name: fg_tipo_certificado; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.fg_tipo_certificado (
    clave character varying(30) NOT NULL,
    nombre character varying(100) NOT NULL,
    descripcion character varying(300),
    activo boolean DEFAULT true NOT NULL,
    entidad_certificadora_nombre character varying(300),
    resolucion_directoral character varying(150),
    domicilio_fiscal character varying(500),
    telefono character varying(30),
    lugar_emision character varying(150),
    codigo character varying(2) NOT NULL,
    ancho_correlativo smallint,
    CONSTRAINT ck_fg_tipo_certificado_ancho_correlativo CHECK (((ancho_correlativo IS NULL) OR ((ancho_correlativo >= 1) AND (ancho_correlativo <= 12))))
);



--
-- Name: fg_usuario; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.fg_usuario (
    username character varying(255) NOT NULL,
    user_type character varying(31) NOT NULL,
    contrasenha character varying(255) NOT NULL,
    perfil_id character varying(255),
    persona_nrodocumentoidentidad character varying(20),
    estado boolean,
    foto text
);



--
-- Name: fg_usuario_planta; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.fg_usuario_planta (
    usuario_username character varying(255) NOT NULL,
    plantas_key character varying(20) NOT NULL
);



--
-- Name: fg_usuario_sesion; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.fg_usuario_sesion (
    id bigint NOT NULL,
    usuario_username character varying(255) NOT NULL,
    logintime_utc timestamp without time zone DEFAULT timezone('UTC'::text, now()) NOT NULL,
    isactive boolean DEFAULT true NOT NULL,
    server_name character varying(100),
    clienteip character varying(45),
    logouttime_utc timestamp without time zone,
    session_jti uuid NOT NULL,
    revoked_at_utc timestamp without time zone,
    jwt_jti uuid,
    access_expires_utc timestamp without time zone,
    refresh_token_hash text,
    refresh_expires_utc timestamp without time zone,
    planta_key character varying(20)
);



--
-- Name: fg_usuario_sesion_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.fg_usuario_sesion_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: fg_usuario_sesion_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.fg_usuario_sesion_id_seq OWNED BY public.fg_usuario_sesion.id;


--
-- Name: fg_vehiculo; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.fg_vehiculo (
    id bigint NOT NULL,
    placa character varying(255) NOT NULL,
    placa_normalizada character varying(255) GENERATED ALWAYS AS (upper(btrim((placa)::text))) STORED,
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
    numero_cilindros character varying(50),
    cilindrada character varying(50),
    numero_ejes character varying(50),
    numero_ruedas character varying(50),
    numero_asientos character varying(50),
    numero_pasajeros character varying(50),
    longitud character varying(50),
    ancho character varying(50),
    alto character varying(50),
    peso_neto character varying(50),
    peso_bruto character varying(50),
    carga_util character varying(50),
    potencia character varying(100),
    formula_rodante character varying(50),
    fuente_ultima character varying(20) NOT NULL,
    certificado_origen_id bigint,
    confirmado boolean DEFAULT false NOT NULL,
    usuario_creacion character varying(255) NOT NULL,
    fecha_creacion timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    usuario_modificacion character varying(255),
    fecha_modificacion timestamp without time zone,
    CONSTRAINT ck_fg_vehiculo_fuente CHECK (((fuente_ultima)::text = ANY ((ARRAY['FARENET'::character varying, 'FAREGAS'::character varying, 'MANUAL'::character varying])::text[]))),
    CONSTRAINT ck_fg_vehiculo_placa_no_vacia CHECK ((btrim((placa)::text) <> ''::text))
);



--
-- Name: fg_vehiculo_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.fg_vehiculo ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.fg_vehiculo_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: fg_venta; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.fg_venta (
    id bigint NOT NULL,
    planta_key character varying(50) NOT NULL,
    cliente_tipo_documento character varying(20) NOT NULL,
    cliente_nro_documento character varying(20) NOT NULL,
    cliente_nombre character varying(255) NOT NULL,
    cliente_direccion character varying(255),
    cliente_email character varying(255),
    base_imponible numeric(10,2) NOT NULL,
    igv numeric(10,2) NOT NULL,
    importe_total numeric(10,2) NOT NULL,
    estado character varying(50) DEFAULT 'COMPLETADO'::character varying,
    creado_por character varying(100),
    creado_en timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);



--
-- Name: fg_venta_detalle; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.fg_venta_detalle (
    id bigint NOT NULL,
    venta_id bigint NOT NULL,
    chip_id bigint NOT NULL,
    producto_inventariable_id bigint NOT NULL,
    precio_unitario numeric(10,2) NOT NULL,
    cantidad integer DEFAULT 1,
    total numeric(10,2) NOT NULL
);



--
-- Name: fg_venta_detalle_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.fg_venta_detalle_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: fg_venta_detalle_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.fg_venta_detalle_id_seq OWNED BY public.fg_venta_detalle.id;


--
-- Name: fg_venta_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.fg_venta_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: fg_venta_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.fg_venta_id_seq OWNED BY public.fg_venta.id;


--
-- Name: fg_auditoria_acceso id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_auditoria_acceso ALTER COLUMN id SET DEFAULT nextval('public.fg_auditoria_acceso_id_seq'::regclass);


--
-- Name: fg_auditoria_config id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_auditoria_config ALTER COLUMN id SET DEFAULT nextval('public.fg_auditoria_config_id_seq'::regclass);


--
-- Name: fg_certificado id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_certificado ALTER COLUMN id SET DEFAULT nextval('public.fg_certificado_id_seq'::regclass);


--
-- Name: fg_certificado_formato id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_certificado_formato ALTER COLUMN id SET DEFAULT nextval('public.fg_certificado_formato_id_seq'::regclass);


--
-- Name: fg_certificado_formato_version id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_certificado_formato_version ALTER COLUMN id SET DEFAULT nextval('public.fg_certificado_formato_version_id_seq'::regclass);


--
-- Name: fg_certificado_glp_componente id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_certificado_glp_componente ALTER COLUMN id SET DEFAULT nextval('public.fg_certificado_glp_componente_id_seq'::regclass);


--
-- Name: fg_certificado_glp_verificacion id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_certificado_glp_verificacion ALTER COLUMN id SET DEFAULT nextval('public.fg_certificado_glp_verificacion_id_seq'::regclass);


--
-- Name: fg_certificado_gnv_componente id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_certificado_gnv_componente ALTER COLUMN id SET DEFAULT nextval('public.fg_certificado_gnv_componente_id_seq'::regclass);


--
-- Name: fg_certificado_gnv_verificacion id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_certificado_gnv_verificacion ALTER COLUMN id SET DEFAULT nextval('public.fg_certificado_gnv_verificacion_id_seq'::regclass);


--
-- Name: fg_certificado_titular id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_certificado_titular ALTER COLUMN id SET DEFAULT nextval('public.fg_certificado_titular_id_seq'::regclass);


--
-- Name: fg_certificado_version id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_certificado_version ALTER COLUMN id SET DEFAULT nextval('public.fg_certificado_version_id_seq'::regclass);


--
-- Name: fg_cliente id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_cliente ALTER COLUMN id SET DEFAULT nextval('public.fg_cliente_id_seq'::regclass);


--
-- Name: fg_correlativo_certificado id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_correlativo_certificado ALTER COLUMN id SET DEFAULT nextval('public.fg_correlativo_certificado_id_seq'::regclass);


--
-- Name: fg_correlativo_certificado_sede id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_correlativo_certificado_sede ALTER COLUMN id SET DEFAULT nextval('public.fg_correlativo_certificado_sede_id_seq'::regclass);


--
-- Name: fg_credito id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_credito ALTER COLUMN id SET DEFAULT nextval('public.fg_credito_id_seq'::regclass);


--
-- Name: fg_debito id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_debito ALTER COLUMN id SET DEFAULT nextval('public.fg_debito_id_seq'::regclass);


--
-- Name: fg_descuento id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_descuento ALTER COLUMN id SET DEFAULT nextval('public.fg_descuento_id_seq'::regclass);


--
-- Name: fg_descuentocliente id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_descuentocliente ALTER COLUMN id SET DEFAULT nextval('public.fg_descuentocliente_id_seq'::regclass);


--
-- Name: fg_descuentocomprobante id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_descuentocomprobante ALTER COLUMN id SET DEFAULT nextval('public.fg_descuentocomprobante_id_seq'::regclass);


--
-- Name: fg_descuentodetalle id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_descuentodetalle ALTER COLUMN id SET DEFAULT nextval('public.fg_descuentodetalle_id_seq'::regclass);


--
-- Name: fg_ejecutivo id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_ejecutivo ALTER COLUMN id SET DEFAULT nextval('public.fg_ejecutivo_id_seq'::regclass);


--
-- Name: fg_notificacion id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_notificacion ALTER COLUMN id SET DEFAULT nextval('public.fg_notificacion_id_seq'::regclass);


--
-- Name: fg_notificacion_destinatario id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_notificacion_destinatario ALTER COLUMN id SET DEFAULT nextval('public.fg_notificacion_destinatario_id_seq'::regclass);


--
-- Name: fg_operacion_comercial id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_operacion_comercial ALTER COLUMN id SET DEFAULT nextval('public.fg_operacion_comercial_id_seq'::regclass);


--
-- Name: fg_operacion_detalle id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_operacion_detalle ALTER COLUMN id SET DEFAULT nextval('public.fg_operacion_detalle_id_seq'::regclass);


--
-- Name: fg_producto_sede id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_producto_sede ALTER COLUMN id SET DEFAULT nextval('public.fg_producto_sede_id_seq'::regclass);


--
-- Name: fg_servicio id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_servicio ALTER COLUMN id SET DEFAULT nextval('public.fg_servicio_id_seq'::regclass);


--
-- Name: fg_taller_autorizado id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_taller_autorizado ALTER COLUMN id SET DEFAULT nextval('public.fg_taller_autorizado_id_seq'::regclass);


--
-- Name: fg_tarifa id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_tarifa ALTER COLUMN id SET DEFAULT nextval('public.fg_tarifa_id_seq'::regclass);


--
-- Name: fg_usuario_sesion id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_usuario_sesion ALTER COLUMN id SET DEFAULT nextval('public.fg_usuario_sesion_id_seq'::regclass);


--
-- Name: fg_venta id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_venta ALTER COLUMN id SET DEFAULT nextval('public.fg_venta_id_seq'::regclass);


--
-- Name: fg_venta_detalle id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_venta_detalle ALTER COLUMN id SET DEFAULT nextval('public.fg_venta_detalle_id_seq'::regclass);


--
-- Name: fg_correlativo_certificado_sede excl_fg_corr_sede_rango; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_correlativo_certificado_sede
    ADD CONSTRAINT excl_fg_corr_sede_rango EXCLUDE USING gist (int8range(rango_inicio, rango_fin, '[]'::text) WITH &&);


--
-- Name: fg_correlativo_certificado excl_fg_correlativo_rango; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_correlativo_certificado
    ADD CONSTRAINT excl_fg_correlativo_rango EXCLUDE USING gist (tipo_certificado_clave WITH =, int8range(nro_inicio, nro_maximo, '[]'::text) WITH &&);


--
-- Name: fg_auditoria_acceso fg_auditoria_acceso_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

-- =============================================================================
-- SECCIÓN 4: RESTRICCIONES Y CLAVES FORÁNEAS
-- =============================================================================
ALTER TABLE ONLY public.fg_auditoria_acceso
    ADD CONSTRAINT fg_auditoria_acceso_pkey PRIMARY KEY (id);


--
-- Name: fg_auditoria_config fg_auditoria_config_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_auditoria_config
    ADD CONSTRAINT fg_auditoria_config_pkey PRIMARY KEY (id);


--
-- Name: fg_categoria_servicio fg_categoria_servicio_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_categoria_servicio
    ADD CONSTRAINT fg_categoria_servicio_pkey PRIMARY KEY (id);


--
-- Name: fg_certificado_chip fg_certificado_chip_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_certificado_chip
    ADD CONSTRAINT fg_certificado_chip_pkey PRIMARY KEY (certificado_id, chip_id);


--
-- Name: fg_certificado_conformidad fg_certificado_conformidad_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_certificado_conformidad
    ADD CONSTRAINT fg_certificado_conformidad_pkey PRIMARY KEY (certificado_id);


--
-- Name: fg_certificado_duplicado fg_certificado_duplicado_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_certificado_duplicado
    ADD CONSTRAINT fg_certificado_duplicado_pkey PRIMARY KEY (id);


--
-- Name: fg_certificado_formato fg_certificado_formato_codigo_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_certificado_formato
    ADD CONSTRAINT fg_certificado_formato_codigo_key UNIQUE (codigo);


--
-- Name: fg_certificado_formato fg_certificado_formato_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_certificado_formato
    ADD CONSTRAINT fg_certificado_formato_pkey PRIMARY KEY (id);


--
-- Name: fg_certificado_formato_version fg_certificado_formato_version_formato_id_version_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_certificado_formato_version
    ADD CONSTRAINT fg_certificado_formato_version_formato_id_version_key UNIQUE (formato_id, version);


--
-- Name: fg_certificado_formato_version fg_certificado_formato_version_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_certificado_formato_version
    ADD CONSTRAINT fg_certificado_formato_version_pkey PRIMARY KEY (id);


--
-- Name: fg_certificado_glp_componente fg_certificado_glp_componente_certificado_id_orden_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_certificado_glp_componente
    ADD CONSTRAINT fg_certificado_glp_componente_certificado_id_orden_key UNIQUE (certificado_id, orden);


--
-- Name: fg_certificado_glp_componente fg_certificado_glp_componente_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_certificado_glp_componente
    ADD CONSTRAINT fg_certificado_glp_componente_pkey PRIMARY KEY (id);


--
-- Name: fg_certificado_glp fg_certificado_glp_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_certificado_glp
    ADD CONSTRAINT fg_certificado_glp_pkey PRIMARY KEY (certificado_id);


--
-- Name: fg_certificado_glp_verificacion fg_certificado_glp_verificacion_certificado_id_codigo_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_certificado_glp_verificacion
    ADD CONSTRAINT fg_certificado_glp_verificacion_certificado_id_codigo_key UNIQUE (certificado_id, codigo);


--
-- Name: fg_certificado_glp_verificacion fg_certificado_glp_verificacion_certificado_id_orden_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_certificado_glp_verificacion
    ADD CONSTRAINT fg_certificado_glp_verificacion_certificado_id_orden_key UNIQUE (certificado_id, orden);


--
-- Name: fg_certificado_glp_verificacion fg_certificado_glp_verificacion_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_certificado_glp_verificacion
    ADD CONSTRAINT fg_certificado_glp_verificacion_pkey PRIMARY KEY (id);


--
-- Name: fg_certificado_gnv_componente fg_certificado_gnv_componente_certificado_id_orden_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_certificado_gnv_componente
    ADD CONSTRAINT fg_certificado_gnv_componente_certificado_id_orden_key UNIQUE (certificado_id, orden);


--
-- Name: fg_certificado_gnv_componente fg_certificado_gnv_componente_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_certificado_gnv_componente
    ADD CONSTRAINT fg_certificado_gnv_componente_pkey PRIMARY KEY (id);


--
-- Name: fg_certificado_gnv fg_certificado_gnv_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_certificado_gnv
    ADD CONSTRAINT fg_certificado_gnv_pkey PRIMARY KEY (certificado_id);


--
-- Name: fg_certificado_gnv_verificacion fg_certificado_gnv_verificacion_certificado_id_codigo_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_certificado_gnv_verificacion
    ADD CONSTRAINT fg_certificado_gnv_verificacion_certificado_id_codigo_key UNIQUE (certificado_id, codigo);


--
-- Name: fg_certificado_gnv_verificacion fg_certificado_gnv_verificacion_certificado_id_orden_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_certificado_gnv_verificacion
    ADD CONSTRAINT fg_certificado_gnv_verificacion_certificado_id_orden_key UNIQUE (certificado_id, orden);


--
-- Name: fg_certificado_gnv_verificacion fg_certificado_gnv_verificacion_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_certificado_gnv_verificacion
    ADD CONSTRAINT fg_certificado_gnv_verificacion_pkey PRIMARY KEY (id);


--
-- Name: fg_certificado fg_certificado_numero_certificado_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_certificado
    ADD CONSTRAINT fg_certificado_numero_certificado_key UNIQUE (numero_certificado);


--
-- Name: fg_certificado fg_certificado_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_certificado
    ADD CONSTRAINT fg_certificado_pkey PRIMARY KEY (id);


--
-- Name: fg_certificado_titular fg_certificado_titular_certificado_id_orden_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_certificado_titular
    ADD CONSTRAINT fg_certificado_titular_certificado_id_orden_key UNIQUE (certificado_id, orden);


--
-- Name: fg_certificado_titular fg_certificado_titular_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_certificado_titular
    ADD CONSTRAINT fg_certificado_titular_pkey PRIMARY KEY (id);


--
-- Name: fg_certificado_vehiculo fg_certificado_vehiculo_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_certificado_vehiculo
    ADD CONSTRAINT fg_certificado_vehiculo_pkey PRIMARY KEY (certificado_id);


--
-- Name: fg_certificado_version fg_certificado_version_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_certificado_version
    ADD CONSTRAINT fg_certificado_version_pkey PRIMARY KEY (id);


--
-- Name: fg_chip_movimiento fg_chip_movimiento_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_chip_movimiento
    ADD CONSTRAINT fg_chip_movimiento_pkey PRIMARY KEY (id);


--
-- Name: fg_chip fg_chip_numero_chip_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_chip
    ADD CONSTRAINT fg_chip_numero_chip_key UNIQUE (numero_chip);


--
-- Name: fg_chip fg_chip_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_chip
    ADD CONSTRAINT fg_chip_pkey PRIMARY KEY (id);


--
-- Name: fg_cliente fg_cliente_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_cliente
    ADD CONSTRAINT fg_cliente_pkey PRIMARY KEY (id);


--
-- Name: fg_cliente fg_cliente_tipo_documento_nro_documento_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_cliente
    ADD CONSTRAINT fg_cliente_tipo_documento_nro_documento_key UNIQUE (tipo_documento, nro_documento);


--
-- Name: fg_correlativo_certificado fg_correlativo_certificado_hist_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_correlativo_certificado
    ADD CONSTRAINT fg_correlativo_certificado_hist_key UNIQUE (planta_key, tipo_certificado_clave, modalidad, nro_inicio, nro_maximo);


--
-- Name: fg_correlativo_certificado fg_correlativo_certificado_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_correlativo_certificado
    ADD CONSTRAINT fg_correlativo_certificado_pkey PRIMARY KEY (id);


--
-- Name: fg_correlativo_certificado_sede fg_correlativo_certificado_sede_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_correlativo_certificado_sede
    ADD CONSTRAINT fg_correlativo_certificado_sede_pkey PRIMARY KEY (id);


--
-- Name: fg_credito fg_credito_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_credito
    ADD CONSTRAINT fg_credito_pkey PRIMARY KEY (id);


--
-- Name: fg_debito fg_debito_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_debito
    ADD CONSTRAINT fg_debito_pkey PRIMARY KEY (id);


--
-- Name: fg_descuento fg_descuento_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_descuento
    ADD CONSTRAINT fg_descuento_pkey PRIMARY KEY (id);


--
-- Name: fg_descuentocliente fg_descuentocliente_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_descuentocliente
    ADD CONSTRAINT fg_descuentocliente_pkey PRIMARY KEY (id);


--
-- Name: fg_descuentocomprobante fg_descuentocomprobante_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_descuentocomprobante
    ADD CONSTRAINT fg_descuentocomprobante_pkey PRIMARY KEY (id);


--
-- Name: fg_descuentodetalle fg_descuentodetalle_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_descuentodetalle
    ADD CONSTRAINT fg_descuentodetalle_pkey PRIMARY KEY (id);


--
-- Name: fg_documento_anulacion fg_documento_anulacion_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_documento_anulacion
    ADD CONSTRAINT fg_documento_anulacion_pkey PRIMARY KEY (id);


--
-- Name: fg_documento_electronico_operacion fg_documento_electronico_operacion_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_documento_electronico_operacion
    ADD CONSTRAINT fg_documento_electronico_operacion_pkey PRIMARY KEY (id);


--
-- Name: fg_ejecutivo fg_ejecutivo_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_ejecutivo
    ADD CONSTRAINT fg_ejecutivo_pkey PRIMARY KEY (id);


--
-- Name: fg_empresa_facturador fg_empresa_facturador_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_empresa_facturador
    ADD CONSTRAINT fg_empresa_facturador_pkey PRIMARY KEY (id);


--
-- Name: fg_empresa fg_empresa_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_empresa
    ADD CONSTRAINT fg_empresa_pkey PRIMARY KEY (key);


--
-- Name: fg_facturacion fg_facturacion_certificado_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_facturacion
    ADD CONSTRAINT fg_facturacion_certificado_id_key UNIQUE (certificado_id);


--
-- Name: fg_facturacion_cuota fg_facturacion_cuota_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_facturacion_cuota
    ADD CONSTRAINT fg_facturacion_cuota_pkey PRIMARY KEY (id);


--
-- Name: fg_facturacion_intento fg_facturacion_intento_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_facturacion_intento
    ADD CONSTRAINT fg_facturacion_intento_pkey PRIMARY KEY (id);


--
-- Name: fg_facturacion fg_facturacion_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_facturacion
    ADD CONSTRAINT fg_facturacion_pkey PRIMARY KEY (id);


--
-- Name: fg_inventario_cantidad_movimiento fg_inventario_cantidad_movimiento_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_inventario_cantidad_movimiento
    ADD CONSTRAINT fg_inventario_cantidad_movimiento_pkey PRIMARY KEY (id);


--
-- Name: fg_inventario_cantidad_movimiento fg_inventario_cantidad_movimiento_venta_uk; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_inventario_cantidad_movimiento
    ADD CONSTRAINT fg_inventario_cantidad_movimiento_venta_uk UNIQUE (operacion_detalle_id);


--
-- Name: fg_nota_credito_trabajo fg_nota_credito_trabajo_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_nota_credito_trabajo
    ADD CONSTRAINT fg_nota_credito_trabajo_pkey PRIMARY KEY (id);


--
-- Name: fg_notificacion_destinatario fg_notificacion_destinatario_notificacion_id_usuario_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_notificacion_destinatario
    ADD CONSTRAINT fg_notificacion_destinatario_notificacion_id_usuario_id_key UNIQUE (notificacion_id, usuario_id);


--
-- Name: fg_notificacion_destinatario fg_notificacion_destinatario_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_notificacion_destinatario
    ADD CONSTRAINT fg_notificacion_destinatario_pkey PRIMARY KEY (id);


--
-- Name: fg_notificacion fg_notificacion_evento_clave_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_notificacion
    ADD CONSTRAINT fg_notificacion_evento_clave_key UNIQUE (evento_clave);


--
-- Name: fg_notificacion fg_notificacion_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_notificacion
    ADD CONSTRAINT fg_notificacion_pkey PRIMARY KEY (id);


--
-- Name: fg_operacion_comercial fg_operacion_comercial_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_operacion_comercial
    ADD CONSTRAINT fg_operacion_comercial_pkey PRIMARY KEY (id);


--
-- Name: fg_operacion_detalle_chip fg_operacion_detalle_chip_chip_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_operacion_detalle_chip
    ADD CONSTRAINT fg_operacion_detalle_chip_chip_id_key UNIQUE (chip_id);


--
-- Name: fg_operacion_detalle_chip fg_operacion_detalle_chip_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_operacion_detalle_chip
    ADD CONSTRAINT fg_operacion_detalle_chip_pkey PRIMARY KEY (operacion_detalle_id);


--
-- Name: fg_operacion_detalle fg_operacion_detalle_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_operacion_detalle
    ADD CONSTRAINT fg_operacion_detalle_pkey PRIMARY KEY (id);


--
-- Name: fg_orden_pago fg_orden_pago_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_orden_pago
    ADD CONSTRAINT fg_orden_pago_pkey PRIMARY KEY (id);


--
-- Name: fg_pago fg_pago_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_pago
    ADD CONSTRAINT fg_pago_pkey PRIMARY KEY (id);


--
-- Name: fg_perfil fg_perfil_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_perfil
    ADD CONSTRAINT fg_perfil_pkey PRIMARY KEY (clave);


--
-- Name: fg_perfil_planta fg_perfil_planta_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_perfil_planta
    ADD CONSTRAINT fg_perfil_planta_pkey PRIMARY KEY (perfil_clave, planta_key);


--
-- Name: fg_permiso fg_permiso_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_permiso
    ADD CONSTRAINT fg_permiso_pkey PRIMARY KEY (clave);


--
-- Name: fg_planta fg_planta_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_planta
    ADD CONSTRAINT fg_planta_pkey PRIMARY KEY (key);


--
-- Name: fg_producto_facturacion fg_producto_facturacion_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_producto_facturacion
    ADD CONSTRAINT fg_producto_facturacion_pkey PRIMARY KEY (id);


--
-- Name: fg_producto_inventariable fg_producto_inventariable_codigo_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_producto_inventariable
    ADD CONSTRAINT fg_producto_inventariable_codigo_key UNIQUE (codigo);


--
-- Name: fg_producto_inventariable fg_producto_inventariable_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_producto_inventariable
    ADD CONSTRAINT fg_producto_inventariable_pkey PRIMARY KEY (id);


--
-- Name: fg_producto_inventariable_sede fg_producto_inventariable_sede_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_producto_inventariable_sede
    ADD CONSTRAINT fg_producto_inventariable_sede_pkey PRIMARY KEY (id);


--
-- Name: fg_producto_sede fg_producto_sede_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_producto_sede
    ADD CONSTRAINT fg_producto_sede_pkey PRIMARY KEY (id);


--
-- Name: fg_serie_comprobante fg_serie_comprobante_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_serie_comprobante
    ADD CONSTRAINT fg_serie_comprobante_pkey PRIMARY KEY (id);


--
-- Name: fg_servicio fg_servicio_codigo_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_servicio
    ADD CONSTRAINT fg_servicio_codigo_key UNIQUE (codigo);


--
-- Name: fg_servicio fg_servicio_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_servicio
    ADD CONSTRAINT fg_servicio_pkey PRIMARY KEY (id);


--
-- Name: fg_solicitud_operacion_evento fg_solicitud_operacion_evento_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_solicitud_operacion_evento
    ADD CONSTRAINT fg_solicitud_operacion_evento_pkey PRIMARY KEY (id);


--
-- Name: fg_solicitud_operacion fg_solicitud_operacion_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_solicitud_operacion
    ADD CONSTRAINT fg_solicitud_operacion_pkey PRIMARY KEY (id);


--
-- Name: fg_taller_autorizado fg_taller_autorizado_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_taller_autorizado
    ADD CONSTRAINT fg_taller_autorizado_pkey PRIMARY KEY (id);


--
-- Name: fg_tarifa fg_tarifa_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_tarifa
    ADD CONSTRAINT fg_tarifa_pkey PRIMARY KEY (id);


--
-- Name: fg_tipo_certificado fg_tipo_certificado_codigo_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_tipo_certificado
    ADD CONSTRAINT fg_tipo_certificado_codigo_key UNIQUE (codigo);


--
-- Name: fg_tipo_certificado fg_tipo_certificado_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_tipo_certificado
    ADD CONSTRAINT fg_tipo_certificado_pkey PRIMARY KEY (clave);


--
-- Name: fg_usuario fg_usuario_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_usuario
    ADD CONSTRAINT fg_usuario_pkey PRIMARY KEY (username);


--
-- Name: fg_usuario_sesion fg_usuario_sesion_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_usuario_sesion
    ADD CONSTRAINT fg_usuario_sesion_pkey PRIMARY KEY (id);


--
-- Name: fg_usuario_sesion fg_usuario_sesion_session_jti_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_usuario_sesion
    ADD CONSTRAINT fg_usuario_sesion_session_jti_key UNIQUE (session_jti);


--
-- Name: fg_vehiculo fg_vehiculo_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_vehiculo
    ADD CONSTRAINT fg_vehiculo_pkey PRIMARY KEY (id);


--
-- Name: fg_venta_detalle fg_venta_detalle_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_venta_detalle
    ADD CONSTRAINT fg_venta_detalle_pkey PRIMARY KEY (id);


--
-- Name: fg_venta fg_venta_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_venta
    ADD CONSTRAINT fg_venta_pkey PRIMARY KEY (id);


--
-- Name: fg_perfil_permiso pk_fg_perfil_permiso; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_perfil_permiso
    ADD CONSTRAINT pk_fg_perfil_permiso PRIMARY KEY (perfil_clave, permiso_clave);


--
-- Name: fg_usuario_planta pk_fg_usuario_planta; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_usuario_planta
    ADD CONSTRAINT pk_fg_usuario_planta PRIMARY KEY (usuario_username, plantas_key);


--
-- Name: fg_categoria_servicio uk_fg_categoria_servicio_codigo; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_categoria_servicio
    ADD CONSTRAINT uk_fg_categoria_servicio_codigo UNIQUE (codigo);


--
-- Name: fg_producto_facturacion uk_fg_producto_facturacion_sku; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_producto_facturacion
    ADD CONSTRAINT uk_fg_producto_facturacion_sku UNIQUE (codigo_sku);


--
-- Name: fg_serie_comprobante uk_fg_serie_comprobante_sede_tipo_serie; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_serie_comprobante
    ADD CONSTRAINT uk_fg_serie_comprobante_sede_tipo_serie UNIQUE (planta_key, tipo_comprobante, serie);


--
-- Name: fg_tarifa uk_fg_tarifa_planta_codigo; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_tarifa
    ADD CONSTRAINT uk_fg_tarifa_planta_codigo UNIQUE (planta_key, codigo);


--
-- Name: fg_documento_anulacion uq_fg_anulacion_codigo; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_documento_anulacion
    ADD CONSTRAINT uq_fg_anulacion_codigo UNIQUE (codigo_unico);


--
-- Name: fg_certificado_chip uq_fg_certificado_chip_chip; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_certificado_chip
    ADD CONSTRAINT uq_fg_certificado_chip_chip UNIQUE (chip_id);


--
-- Name: fg_certificado_duplicado uq_fg_certificado_duplicado_facturacion; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_certificado_duplicado
    ADD CONSTRAINT uq_fg_certificado_duplicado_facturacion UNIQUE (facturacion_id);


--
-- Name: fg_certificado_duplicado uq_fg_certificado_duplicado_operacion; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_certificado_duplicado
    ADD CONSTRAINT uq_fg_certificado_duplicado_operacion UNIQUE (operacion_id);


--
-- Name: fg_certificado_version uq_fg_certificado_version_num; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_certificado_version
    ADD CONSTRAINT uq_fg_certificado_version_num UNIQUE (certificado_id, numero_version);


--
-- Name: fg_empresa_facturador uq_fg_empresa_facturador; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_empresa_facturador
    ADD CONSTRAINT uq_fg_empresa_facturador UNIQUE (empresa_key, proveedor, entorno);


--
-- Name: fg_empresa_facturador uq_fg_empresa_facturador_credencial; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_empresa_facturador
    ADD CONSTRAINT uq_fg_empresa_facturador_credencial UNIQUE (proveedor, entorno, credencial_clave);


--
-- Name: fg_facturacion_cuota uq_fg_facturacion_cuota_numero; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_facturacion_cuota
    ADD CONSTRAINT uq_fg_facturacion_cuota_numero UNIQUE (facturacion_id, numero_cuota);


--
-- Name: fg_facturacion uq_fg_facturacion_emisor_serie_numero; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_facturacion
    ADD CONSTRAINT uq_fg_facturacion_emisor_serie_numero UNIQUE (ruc_emisor, entorno_facturador, tipo_comprobante, serie, numero);


--
-- Name: fg_facturacion_intento uq_fg_facturacion_intento_numero; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_facturacion_intento
    ADD CONSTRAINT uq_fg_facturacion_intento_numero UNIQUE (facturacion_id, numero_intento);


--
-- Name: fg_nota_credito_trabajo uq_fg_nota_credito_trabajo_solicitud; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_nota_credito_trabajo
    ADD CONSTRAINT uq_fg_nota_credito_trabajo_solicitud UNIQUE (solicitud_id);


--
-- Name: fg_operacion_detalle uq_fg_operacion_detalle_orden; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_operacion_detalle
    ADD CONSTRAINT uq_fg_operacion_detalle_orden UNIQUE (operacion_id, orden);


--
-- Name: fg_orden_pago uq_fg_orden_pago_certificado; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_orden_pago
    ADD CONSTRAINT uq_fg_orden_pago_certificado UNIQUE (certificado_id);


--
-- Name: fg_producto_inventariable_sede uq_fg_producto_inventariable_sede; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_producto_inventariable_sede
    ADD CONSTRAINT uq_fg_producto_inventariable_sede UNIQUE (producto_inventariable_id, planta_key);


--
-- Name: fg_producto_sede uq_fg_producto_sede; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_producto_sede
    ADD CONSTRAINT uq_fg_producto_sede UNIQUE (planta_key, producto_facturacion_id);


--
-- Name: fg_solicitud_operacion uq_fg_solicitud_idempotencia; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_solicitud_operacion
    ADD CONSTRAINT uq_fg_solicitud_idempotencia UNIQUE (usuario_solicitante, idempotencia_clave);


--
-- Name: fg_vehiculo uq_fg_vehiculo_placa_normalizada; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_vehiculo
    ADD CONSTRAINT uq_fg_vehiculo_placa_normalizada UNIQUE (placa_normalizada);


--
-- Name: fg_correlativo_certificado_activo_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX fg_correlativo_certificado_activo_idx ON public.fg_correlativo_certificado USING btree (planta_key, tipo_certificado_clave, modalidad) WHERE (activo = true);


--
-- Name: fg_inventario_cantidad_movimiento_operacion_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX fg_inventario_cantidad_movimiento_operacion_idx ON public.fg_inventario_cantidad_movimiento USING btree (operacion_detalle_id) WHERE (operacion_detalle_id IS NOT NULL);


--
-- Name: fg_inventario_cantidad_movimiento_stock_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX fg_inventario_cantidad_movimiento_stock_idx ON public.fg_inventario_cantidad_movimiento USING btree (producto_inventariable_id, planta_key, fecha_creacion, id);


--
-- Name: idx_fg_auditoria_acceso_evento; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_fg_auditoria_acceso_evento ON public.fg_auditoria_acceso USING btree (evento);


--
-- Name: idx_fg_auditoria_acceso_fecha_evento; Type: INDEX; Schema: public; Owner: postgres
--

-- =============================================================================
-- SECCIÓN 5: ÍNDICES
-- =============================================================================
CREATE INDEX idx_fg_auditoria_acceso_fecha_evento ON public.fg_auditoria_acceso USING btree (fecha_evento);


--
-- Name: idx_fg_auditoria_acceso_username; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_fg_auditoria_acceso_username ON public.fg_auditoria_acceso USING btree (username);


--
-- Name: idx_fg_auditoria_modulo_fecha; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_fg_auditoria_modulo_fecha ON public.fg_auditoria_acceso USING btree (modulo, fecha_evento DESC);


--
-- Name: idx_fg_auditoria_resultado; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_fg_auditoria_resultado ON public.fg_auditoria_acceso USING btree (resultado);


--
-- Name: idx_fg_auditoria_doc_ref; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_fg_auditoria_doc_ref ON public.fg_auditoria_acceso USING btree (documento_referencia);


--
-- Name: idx_fg_cert_titular_cli; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_fg_cert_titular_cli ON public.fg_certificado_titular USING btree (cliente_id);


--
-- Name: idx_fg_cert_ver_certificado; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_fg_cert_ver_certificado ON public.fg_certificado_version USING btree (certificado_id, numero_version DESC);


--
-- Name: idx_fg_cert_ver_estado; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_fg_cert_ver_estado ON public.fg_certificado_version USING btree (estado_version, fecha_version DESC);


--
-- Name: idx_fg_cert_ver_solicitud; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_fg_cert_ver_solicitud ON public.fg_certificado_version USING btree (solicitud_id);


--
-- Name: idx_fg_certificado_anulado; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_fg_certificado_anulado ON public.fg_certificado USING btree (estado, fecha_anulacion DESC) WHERE ((estado)::text = 'ANULADO'::text);


--
-- Name: idx_fg_certificado_cli; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_fg_certificado_cli ON public.fg_certificado USING btree (cliente_id);


--
-- Name: idx_fg_certificado_duplicado_busqueda; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_fg_certificado_duplicado_busqueda ON public.fg_certificado_duplicado USING btree (planta_key, placa, tipo_certificado_clave, modalidad, fecha_emision_snapshot DESC);


--
-- Name: idx_fg_certificado_duplicado_estado; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_fg_certificado_duplicado_estado ON public.fg_certificado_duplicado USING btree (estado, fecha_solicitud DESC);


--
-- Name: idx_fg_certificado_duplicado_original; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_fg_certificado_duplicado_original ON public.fg_certificado_duplicado USING btree (certificado_original_id);


--
-- Name: idx_fg_certificado_estado; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_fg_certificado_estado ON public.fg_certificado USING btree (estado);


--
-- Name: idx_fg_certificado_fecha; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_fg_certificado_fecha ON public.fg_certificado USING btree (fecha_emision);


--
-- Name: idx_fg_certificado_planta; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_fg_certificado_planta ON public.fg_certificado USING btree (planta_key);


--
-- Name: idx_fg_certificado_solicitud_anulacion; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_fg_certificado_solicitud_anulacion ON public.fg_certificado USING btree (solicitud_anulacion_id) WHERE (solicitud_anulacion_id IS NOT NULL);


--
-- Name: idx_fg_certificado_tipo; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_fg_certificado_tipo ON public.fg_certificado USING btree (tipo_certificado_clave);


--
-- Name: idx_fg_corr_sede_consumo; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_fg_corr_sede_consumo ON public.fg_correlativo_certificado_sede USING btree (planta_key) WHERE ((estado)::text = 'ACTIVO'::text);


--
-- Name: idx_fg_corr_sede_estado; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_fg_corr_sede_estado ON public.fg_correlativo_certificado_sede USING btree (estado, fecha_asignacion);


--
-- Name: idx_fg_corr_sede_planta; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_fg_corr_sede_planta ON public.fg_correlativo_certificado_sede USING btree (planta_key, rango_inicio);


--
-- Name: idx_fg_correlativo_certificado_listado; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_fg_correlativo_certificado_listado ON public.fg_correlativo_certificado USING btree (planta_key, tipo_certificado_clave, modalidad, activo);


--
-- Name: idx_fg_descom_cert; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_fg_descom_cert ON public.fg_descuentocomprobante USING btree (certificado_id);


--
-- Name: idx_fg_descom_descli; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_fg_descom_descli ON public.fg_descuentocomprobante USING btree (descuento_cliente_id);


--
-- Name: idx_fg_descom_descuento_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_fg_descom_descuento_id ON public.fg_descuentocomprobante USING btree (descuento_id);


--
-- Name: idx_fg_descom_estado; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_fg_descom_estado ON public.fg_descuentocomprobante USING btree (estado);


--
-- Name: idx_fg_descuentocliente_doc; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_fg_descuentocliente_doc ON public.fg_descuentocliente USING btree (nro_documento);


--
-- Name: idx_fg_descuentocliente_placa; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_fg_descuentocliente_placa ON public.fg_descuentocliente USING btree (placa);


--
-- Name: idx_fg_descuentocliente_planta; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_fg_descuentocliente_planta ON public.fg_descuentocliente USING btree (planta_key);


--
-- Name: idx_fg_descuentodetalle_codigo; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_fg_descuentodetalle_codigo ON public.fg_descuentodetalle USING btree (descuento_cliente_id);


--
-- Name: idx_fg_descuentodetalle_planta_servicio; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_fg_descuentodetalle_planta_servicio ON public.fg_descuentodetalle USING btree (planta_key, servicio_id);


--
-- Name: idx_fg_empresa_facturador_activo; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_fg_empresa_facturador_activo ON public.fg_empresa_facturador USING btree (empresa_key, proveedor, entorno, activo);


--
-- Name: idx_fg_empresa_listado; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_fg_empresa_listado ON public.fg_empresa USING btree (activo DESC, nombre);


--
-- Name: idx_fg_facturacion_emisor; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_fg_facturacion_emisor ON public.fg_facturacion USING btree (empresa_key, entorno_facturador, fecha_creacion DESC);


--
-- Name: idx_fg_facturacion_estado; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_fg_facturacion_estado ON public.fg_facturacion USING btree (estado);


--
-- Name: idx_fg_facturacion_intento_facturacion; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_fg_facturacion_intento_facturacion ON public.fg_facturacion_intento USING btree (facturacion_id, numero_intento DESC);


--
-- Name: idx_fg_nota_credito_trabajo_bloqueo; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_fg_nota_credito_trabajo_bloqueo ON public.fg_nota_credito_trabajo USING btree (bloqueo_hasta) WHERE ((estado)::text = 'EMITIENDO'::text);


--
-- Name: idx_fg_nota_credito_trabajo_pendiente; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_fg_nota_credito_trabajo_pendiente ON public.fg_nota_credito_trabajo USING btree (estado, disponible_desde, id) WHERE ((estado)::text = ANY ((ARRAY['EN_COLA'::character varying, 'ESPERANDO_COMPROBANTE'::character varying, 'PENDIENTE_SUNAT'::character varying, 'RESULTADO_INCIERTO'::character varying, 'ERROR'::character varying])::text[]));


--
-- Name: idx_fg_notificacion_destinatario_leida; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_fg_notificacion_destinatario_leida ON public.fg_notificacion_destinatario USING btree (leida);


--
-- Name: idx_fg_notificacion_destinatario_usuario; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_fg_notificacion_destinatario_usuario ON public.fg_notificacion_destinatario USING btree (usuario_id);


--
-- Name: idx_fg_notificacion_evento_clave; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_fg_notificacion_evento_clave ON public.fg_notificacion USING btree (evento_clave);


--
-- Name: idx_fg_notificacion_fecha; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_fg_notificacion_fecha ON public.fg_notificacion USING btree (fecha_creacion DESC);


--
-- Name: idx_fg_pago_fecha; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_fg_pago_fecha ON public.fg_pago USING btree (fechacreacion);


--
-- Name: idx_fg_pago_orden; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_fg_pago_orden ON public.fg_pago USING btree (orden_pago_id);


--
-- Name: idx_fg_pago_tipo; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_fg_pago_tipo ON public.fg_pago USING btree (tipocontado_key);


--
-- Name: idx_fg_perfil_permiso_perfil; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_fg_perfil_permiso_perfil ON public.fg_perfil_permiso USING btree (perfil_clave);


--
-- Name: idx_fg_perfil_permiso_permiso; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_fg_perfil_permiso_permiso ON public.fg_perfil_permiso USING btree (permiso_clave);


--
-- Name: idx_fg_planta_empresa; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_fg_planta_empresa ON public.fg_planta USING btree (empresa_key, activo, nombre);


--
-- Name: idx_fg_producto_facturacion_categoria; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_fg_producto_facturacion_categoria ON public.fg_producto_facturacion USING btree (categoria_id, activo);


--
-- Name: idx_fg_producto_facturacion_descripcion; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_fg_producto_facturacion_descripcion ON public.fg_producto_facturacion USING btree (descripcion);


--
-- Name: idx_fg_producto_facturacion_filtros; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_fg_producto_facturacion_filtros ON public.fg_producto_facturacion USING btree (activo, es_para_venta, unidad);


--
-- Name: idx_fg_serie_comprobante_listado; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_fg_serie_comprobante_listado ON public.fg_serie_comprobante USING btree (planta_key, tipo_comprobante, activo);


--
-- Name: idx_fg_servicio_categoria; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_fg_servicio_categoria ON public.fg_servicio USING btree (categoria_id);


--
-- Name: idx_fg_solicitud_cert_tipo_estado; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_fg_solicitud_cert_tipo_estado ON public.fg_solicitud_operacion USING btree (certificado_id, tipo_operacion, estado, fecha_solicitud DESC);


--
-- Name: idx_fg_solicitud_ejecutor; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_fg_solicitud_ejecutor ON public.fg_solicitud_operacion USING btree (usuario_ejecucion, fecha_ejecucion DESC) WHERE (usuario_ejecucion IS NOT NULL);


--
-- Name: idx_fg_solicitud_empresa; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_fg_solicitud_empresa ON public.fg_solicitud_operacion USING btree (empresa_key, fecha_solicitud DESC);


--
-- Name: idx_fg_solicitud_estado; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_fg_solicitud_estado ON public.fg_solicitud_operacion USING btree (estado, fecha_solicitud DESC);


--
-- Name: idx_fg_solicitud_evento_historial; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_fg_solicitud_evento_historial ON public.fg_solicitud_operacion_evento USING btree (solicitud_id, fecha_evento, id);


--
-- Name: idx_fg_solicitud_planta; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_fg_solicitud_planta ON public.fg_solicitud_operacion USING btree (planta_key, fecha_solicitud DESC);


--
-- Name: idx_fg_solicitud_solicitante; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_fg_solicitud_solicitante ON public.fg_solicitud_operacion USING btree (usuario_solicitante, fecha_solicitud DESC);


--
-- Name: idx_fg_solicitud_tipo; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_fg_solicitud_tipo ON public.fg_solicitud_operacion USING btree (tipo_operacion, fecha_solicitud DESC);


--
-- Name: idx_fg_tarifa_producto_facturacion; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_fg_tarifa_producto_facturacion ON public.fg_tarifa USING btree (producto_facturacion_id);


--
-- Name: idx_fg_tarifa_servicio; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_fg_tarifa_servicio ON public.fg_tarifa USING btree (servicio_id);


--
-- Name: idx_fg_usuario_persona_nrodocumento; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_fg_usuario_persona_nrodocumento ON public.fg_usuario USING btree (persona_nrodocumentoidentidad) WHERE (persona_nrodocumentoidentidad IS NOT NULL);


--
-- Name: idx_fg_usuario_sesion_user_active; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_fg_usuario_sesion_user_active ON public.fg_usuario_sesion USING btree (usuario_username, isactive);


--
-- Name: idx_fg_vehiculo_numero_motor; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_fg_vehiculo_numero_motor ON public.fg_vehiculo USING btree (upper((numero_motor)::text)) WHERE (numero_motor IS NOT NULL);


--
-- Name: idx_fg_vehiculo_vin; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_fg_vehiculo_vin ON public.fg_vehiculo USING btree (upper((vin)::text)) WHERE (vin IS NOT NULL);


--
-- Name: ix_fg_auditoria_categoria_fecha; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_fg_auditoria_categoria_fecha ON public.fg_auditoria_acceso USING btree (categoria, fecha_evento DESC);


--
-- Name: ix_fg_auditoria_certificado; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_fg_auditoria_certificado ON public.fg_auditoria_acceso USING btree (certificado_id, fecha_evento DESC) WHERE (certificado_id IS NOT NULL);


--
-- Name: ix_fg_auditoria_placa; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_fg_auditoria_placa ON public.fg_auditoria_acceso USING btree (placa, fecha_evento DESC) WHERE (placa IS NOT NULL);


--
-- Name: ix_fg_certificado_borradores_panel; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_fg_certificado_borradores_panel ON public.fg_certificado USING btree (planta_key, estado, fecha_modificacion DESC, id DESC);


--
-- Name: ix_fg_certificado_panel_fecha_creacion; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_fg_certificado_panel_fecha_creacion ON public.fg_certificado USING btree (planta_key, estado, fecha_creacion DESC, id DESC);


--
-- Name: ix_fg_chip_movimiento_chip; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_fg_chip_movimiento_chip ON public.fg_chip_movimiento USING btree (chip_id, fecha DESC, id DESC);


--
-- Name: ix_fg_chip_stock; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_fg_chip_stock ON public.fg_chip USING btree (planta_actual_key, estado, producto_inventariable_id);


--
-- Name: ix_fg_credito_facturacion; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_fg_credito_facturacion ON public.fg_credito USING btree (facturacion_id, fecha_creacion DESC);


--
-- Name: ix_fg_debito_facturacion; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_fg_debito_facturacion ON public.fg_debito USING btree (facturacion_id, fecha_creacion DESC);


--
-- Name: ix_fg_descuento_ejecutivo; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_fg_descuento_ejecutivo ON public.fg_descuento USING btree (ejecutivo_id) WHERE (ejecutivo_id IS NOT NULL);


--
-- Name: ix_fg_doc_operacion_anulacion; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_fg_doc_operacion_anulacion ON public.fg_documento_electronico_operacion USING btree (anulacion_id, fecha_creacion DESC);


--
-- Name: ix_fg_doc_operacion_credito; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_fg_doc_operacion_credito ON public.fg_documento_electronico_operacion USING btree (credito_id, fecha_creacion DESC);


--
-- Name: ix_fg_doc_operacion_debito; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_fg_doc_operacion_debito ON public.fg_documento_electronico_operacion USING btree (debito_id, fecha_creacion DESC);


--
-- Name: ix_fg_doc_operacion_facturacion; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_fg_doc_operacion_facturacion ON public.fg_documento_electronico_operacion USING btree (facturacion_id, fecha_creacion DESC);


--
-- Name: ix_fg_facturacion_cuota_vencimiento; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_fg_facturacion_cuota_vencimiento ON public.fg_facturacion_cuota USING btree (facturacion_id, fecha_pago, numero_cuota);


--
-- Name: ix_fg_facturacion_pendiente_monitoreo; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_fg_facturacion_pendiente_monitoreo ON public.fg_facturacion USING btree (estado, fecha_ultimo_intento) WHERE ((estado)::text = ANY ((ARRAY['PENDIENTE'::character varying, 'ERROR'::character varying, 'RECHAZADO'::character varying])::text[]));

CREATE INDEX idx_fg_facturacion_detraccion ON public.fg_facturacion USING btree (sujeto_detraccion, detraccion_estado_deposito) WHERE (sujeto_detraccion = true);

CREATE INDEX idx_fg_facturacion_detraccion_constancia ON public.fg_facturacion USING btree (detraccion_constancia_nro) WHERE (detraccion_constancia_nro IS NOT NULL);


--
-- Name: ix_fg_operacion_detalle_operacion; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_fg_operacion_detalle_operacion ON public.fg_operacion_detalle USING btree (operacion_id, orden);


--
-- Name: ix_fg_operacion_panel; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_fg_operacion_panel ON public.fg_operacion_comercial USING btree (planta_key, estado, fecha_creacion DESC, id DESC);


--
-- Name: ix_fg_producto_inventariable_sede_producto_fiscal; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_fg_producto_inventariable_sede_producto_fiscal ON public.fg_producto_inventariable_sede USING btree (producto_facturacion_id);


--
-- Name: ix_fg_producto_sede_catalogo; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_fg_producto_sede_catalogo ON public.fg_producto_sede USING btree (planta_key, activo, orden, producto_facturacion_id);


--
-- Name: ix_fg_usuario_sesion_planta_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_fg_usuario_sesion_planta_key ON public.fg_usuario_sesion USING btree (planta_key) WHERE (planta_key IS NOT NULL);


--
-- Name: uk_fg_corr_sede_activo; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uk_fg_corr_sede_activo ON public.fg_correlativo_certificado_sede USING btree (planta_key) WHERE ((estado)::text = 'ACTIVO'::text);


--
-- Name: uk_fg_serie_comprobante_predeterminada_activa; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uk_fg_serie_comprobante_predeterminada_activa ON public.fg_serie_comprobante USING btree (planta_key, tipo_comprobante, proveedor_emision, entorno_emision) WHERE ((activo = true) AND (es_predeterminada = true));


--
-- Name: uk_fg_tarifa_planta_servicio; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uk_fg_tarifa_planta_servicio ON public.fg_tarifa USING btree (planta_key, servicio_id);


--
-- Name: uq_fg_anulacion_credito_activa; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uq_fg_anulacion_credito_activa ON public.fg_documento_anulacion USING btree (credito_id) WHERE ((credito_id IS NOT NULL) AND ((estado)::text = ANY ((ARRAY['BORRADOR'::character varying, 'PENDIENTE'::character varying, 'ACEPTADO'::character varying])::text[])));


--
-- Name: uq_fg_anulacion_debito_activa; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uq_fg_anulacion_debito_activa ON public.fg_documento_anulacion USING btree (debito_id) WHERE ((debito_id IS NOT NULL) AND ((estado)::text = ANY ((ARRAY['BORRADOR'::character varying, 'PENDIENTE'::character varying, 'ACEPTADO'::character varying])::text[])));


--
-- Name: uq_fg_anulacion_facturacion_activa; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uq_fg_anulacion_facturacion_activa ON public.fg_documento_anulacion USING btree (facturacion_id) WHERE ((facturacion_id IS NOT NULL) AND ((estado)::text = ANY ((ARRAY['BORRADOR'::character varying, 'PENDIENTE'::character varying, 'ACEPTADO'::character varying])::text[])));


--
-- Name: uq_fg_cert_ver_unica_vigente; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uq_fg_cert_ver_unica_vigente ON public.fg_certificado_version USING btree (certificado_id) WHERE (es_vigente = true);


--
-- Name: uq_fg_certificado_duplicado_pendiente_usuario; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uq_fg_certificado_duplicado_pendiente_usuario ON public.fg_certificado_duplicado USING btree (certificado_original_id, solicitado_por) WHERE ((estado)::text = 'PENDIENTE_PAGO'::text);


--
-- Name: uq_fg_credito_proveedor_codigo_unico; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uq_fg_credito_proveedor_codigo_unico ON public.fg_credito USING btree (proveedor, codigo_unico) WHERE (codigo_unico IS NOT NULL);


--
-- Name: uq_fg_credito_serie_numero; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uq_fg_credito_serie_numero ON public.fg_credito USING btree (planta_key, serie, numero) WHERE ((serie IS NOT NULL) AND (numero IS NOT NULL));


--
-- Name: uq_fg_debito_proveedor_codigo_unico; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uq_fg_debito_proveedor_codigo_unico ON public.fg_debito USING btree (proveedor, codigo_unico) WHERE (codigo_unico IS NOT NULL);


--
-- Name: uq_fg_debito_serie_numero; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uq_fg_debito_serie_numero ON public.fg_debito USING btree (planta_key, serie, numero) WHERE ((serie IS NOT NULL) AND (numero IS NOT NULL));


--
-- Name: uq_fg_descom_certificado_activo; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uq_fg_descom_certificado_activo ON public.fg_descuentocomprobante USING btree (certificado_id) WHERE ((estado)::text = ANY ((ARRAY['RESERVADO'::character varying, 'APLICADO'::character varying])::text[]));


--
-- Name: uq_fg_descuento_codigo_upper; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uq_fg_descuento_codigo_upper ON public.fg_descuento USING btree (upper(btrim((codigo)::text)));


--
-- Name: uq_fg_descuentocliente_codigo_upper; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uq_fg_descuentocliente_codigo_upper ON public.fg_descuentocliente USING btree (upper(btrim((codigo)::text)));


--
-- Name: uq_fg_descuentodetalle_descuento_sede_servicio; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uq_fg_descuentodetalle_descuento_sede_servicio ON public.fg_descuentodetalle USING btree (descuento_id, planta_key, servicio_id) WHERE (descuento_cliente_id IS NULL);


--
-- Name: uq_fg_ejecutivo_nombre; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uq_fg_ejecutivo_nombre ON public.fg_ejecutivo USING btree (lower(btrim((nombre)::text)));


--
-- Name: uq_fg_empresa_ruc; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uq_fg_empresa_ruc ON public.fg_empresa USING btree (ruc) WHERE (ruc IS NOT NULL);


--
-- Name: uq_fg_facturacion_operacion; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uq_fg_facturacion_operacion ON public.fg_facturacion USING btree (operacion_id) WHERE (operacion_id IS NOT NULL);


--
-- Name: uq_fg_facturacion_proveedor_codigo_unico; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uq_fg_facturacion_proveedor_codigo_unico ON public.fg_facturacion USING btree (proveedor, codigo_unico) WHERE (codigo_unico IS NOT NULL);


--
-- Name: uq_fg_operacion_detalle_certificado; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uq_fg_operacion_detalle_certificado ON public.fg_operacion_detalle USING btree (certificado_id) WHERE (certificado_id IS NOT NULL);


--
-- Name: uq_fg_orden_pago_operacion; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uq_fg_orden_pago_operacion ON public.fg_orden_pago USING btree (operacion_id) WHERE (operacion_id IS NOT NULL);


--
-- Name: uq_fg_serie_nubefact_demo_emisor_tipo; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uq_fg_serie_nubefact_demo_emisor_tipo ON public.fg_serie_comprobante USING btree (empresa_key, tipo_comprobante, entorno_emision) WHERE (((proveedor_emision)::text = 'NUBEFACT'::text) AND ((entorno_emision)::text = 'DEMO'::text) AND (activo = true) AND (es_predeterminada = true));


--
-- Name: uq_fg_serie_nubefact_empresa_documento; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uq_fg_serie_nubefact_empresa_documento ON public.fg_serie_comprobante USING btree (empresa_key, tipo_comprobante, serie) WHERE ((proveedor_emision)::text = 'NUBEFACT'::text);


--
-- Name: uq_fg_solicitud_activa_certificado; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uq_fg_solicitud_activa_certificado ON public.fg_solicitud_operacion USING btree (certificado_id) WHERE ((certificado_id IS NOT NULL) AND ((estado)::text = ANY ((ARRAY['PENDIENTE_APROBACION'::character varying, 'APROBADA'::character varying, 'EN_EJECUCION'::character varying, 'REQUIERE_INTERVENCION'::character varying])::text[])));


--
-- Name: uq_fg_solicitud_activa_facturacion; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uq_fg_solicitud_activa_facturacion ON public.fg_solicitud_operacion USING btree (facturacion_id) WHERE ((facturacion_id IS NOT NULL) AND ((estado)::text = ANY ((ARRAY['PENDIENTE_APROBACION'::character varying, 'APROBADA'::character varying, 'EN_EJECUCION'::character varying, 'REQUIERE_INTERVENCION'::character varying])::text[])));


--
-- Name: uq_fg_taller_autorizado_planta; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uq_fg_taller_autorizado_planta ON public.fg_taller_autorizado USING btree (planta_key) WHERE (planta_key IS NOT NULL);


--
-- Name: fg_inventario_cantidad_movimiento fg_inventario_cantidad_movimiento_inmutable; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER fg_inventario_cantidad_movimiento_inmutable BEFORE DELETE OR UPDATE ON public.fg_inventario_cantidad_movimiento FOR EACH ROW EXECUTE FUNCTION public.fg_bloquear_mutacion_movimiento_inventario_cantidad();


--
-- Name: fg_solicitud_operacion_evento trg_fg_solicitud_evento_inmutable; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_fg_solicitud_evento_inmutable BEFORE DELETE OR UPDATE ON public.fg_solicitud_operacion_evento FOR EACH ROW EXECUTE FUNCTION public.fg_bloquear_mutacion_solicitud_evento();


--
-- Name: fg_certificado_chip fg_certificado_chip_certificado_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_certificado_chip
    ADD CONSTRAINT fg_certificado_chip_certificado_id_fkey FOREIGN KEY (certificado_id) REFERENCES public.fg_certificado(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_certificado_chip fg_certificado_chip_chip_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_certificado_chip
    ADD CONSTRAINT fg_certificado_chip_chip_id_fkey FOREIGN KEY (chip_id) REFERENCES public.fg_chip(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_certificado_formato fg_certificado_formato_formato_padre_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_certificado_formato
    ADD CONSTRAINT fg_certificado_formato_formato_padre_id_fkey FOREIGN KEY (formato_padre_id) REFERENCES public.fg_certificado_formato(id);


--
-- Name: fg_certificado_formato_version fg_certificado_formato_version_formato_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_certificado_formato_version
    ADD CONSTRAINT fg_certificado_formato_version_formato_id_fkey FOREIGN KEY (formato_id) REFERENCES public.fg_certificado_formato(id) ON DELETE CASCADE;


--
-- Name: fg_certificado fg_certificado_formato_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_certificado
    ADD CONSTRAINT fg_certificado_formato_version_id_fkey FOREIGN KEY (formato_version_id) REFERENCES public.fg_certificado_formato_version(id);


--
-- Name: fg_certificado_gnv_componente fg_certificado_gnv_componente_certificado_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_certificado_gnv_componente
    ADD CONSTRAINT fg_certificado_gnv_componente_certificado_id_fkey FOREIGN KEY (certificado_id) REFERENCES public.fg_certificado_gnv(certificado_id) ON DELETE CASCADE;


--
-- Name: fg_certificado fg_certificado_producto_chip_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_certificado
    ADD CONSTRAINT fg_certificado_producto_chip_id_fkey FOREIGN KEY (producto_chip_id) REFERENCES public.fg_producto_inventariable(id) ON DELETE RESTRICT;


--
-- Name: fg_certificado fg_certificado_producto_facturacion_certificado_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_certificado
    ADD CONSTRAINT fg_certificado_producto_facturacion_certificado_id_fkey FOREIGN KEY (producto_facturacion_certificado_id) REFERENCES public.fg_producto_facturacion(id) ON DELETE RESTRICT;


--
-- Name: fg_certificado fg_certificado_producto_facturacion_chip_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_certificado
    ADD CONSTRAINT fg_certificado_producto_facturacion_chip_id_fkey FOREIGN KEY (producto_facturacion_chip_id) REFERENCES public.fg_producto_facturacion(id) ON DELETE RESTRICT;


--
-- Name: fg_certificado_version fg_certificado_version_certificado_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_certificado_version
    ADD CONSTRAINT fg_certificado_version_certificado_id_fkey FOREIGN KEY (certificado_id) REFERENCES public.fg_certificado(id) ON DELETE RESTRICT;


--
-- Name: fg_certificado_version fg_certificado_version_solicitud_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_certificado_version
    ADD CONSTRAINT fg_certificado_version_solicitud_id_fkey FOREIGN KEY (solicitud_id) REFERENCES public.fg_solicitud_operacion(id) ON DELETE SET NULL;


--
-- Name: fg_certificado_version fg_certificado_version_usuario_aprobacion_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_certificado_version
    ADD CONSTRAINT fg_certificado_version_usuario_aprobacion_fkey FOREIGN KEY (usuario_aprobacion) REFERENCES public.fg_usuario(username) ON DELETE RESTRICT;


--
-- Name: fg_certificado_version fg_certificado_version_usuario_creacion_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_certificado_version
    ADD CONSTRAINT fg_certificado_version_usuario_creacion_fkey FOREIGN KEY (usuario_creacion) REFERENCES public.fg_usuario(username) ON DELETE RESTRICT;


--
-- Name: fg_chip fg_chip_actualizado_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_chip
    ADD CONSTRAINT fg_chip_actualizado_por_fkey FOREIGN KEY (actualizado_por) REFERENCES public.fg_usuario(username) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_chip fg_chip_creado_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_chip
    ADD CONSTRAINT fg_chip_creado_por_fkey FOREIGN KEY (creado_por) REFERENCES public.fg_usuario(username) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_chip_movimiento fg_chip_movimiento_certificado_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_chip_movimiento
    ADD CONSTRAINT fg_chip_movimiento_certificado_id_fkey FOREIGN KEY (certificado_id) REFERENCES public.fg_certificado(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_chip_movimiento fg_chip_movimiento_chip_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_chip_movimiento
    ADD CONSTRAINT fg_chip_movimiento_chip_id_fkey FOREIGN KEY (chip_id) REFERENCES public.fg_chip(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_chip_movimiento fg_chip_movimiento_operacion_comercial_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_chip_movimiento
    ADD CONSTRAINT fg_chip_movimiento_operacion_comercial_id_fkey FOREIGN KEY (operacion_comercial_id) REFERENCES public.fg_operacion_comercial(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_chip_movimiento fg_chip_movimiento_planta_destino_key_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_chip_movimiento
    ADD CONSTRAINT fg_chip_movimiento_planta_destino_key_fkey FOREIGN KEY (planta_destino_key) REFERENCES public.fg_planta(key) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_chip_movimiento fg_chip_movimiento_planta_origen_key_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_chip_movimiento
    ADD CONSTRAINT fg_chip_movimiento_planta_origen_key_fkey FOREIGN KEY (planta_origen_key) REFERENCES public.fg_planta(key) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_chip_movimiento fg_chip_movimiento_usuario_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_chip_movimiento
    ADD CONSTRAINT fg_chip_movimiento_usuario_fkey FOREIGN KEY (usuario) REFERENCES public.fg_usuario(username) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_chip fg_chip_operacion_reserva_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_chip
    ADD CONSTRAINT fg_chip_operacion_reserva_id_fkey FOREIGN KEY (operacion_reserva_id) REFERENCES public.fg_operacion_comercial(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_chip fg_chip_planta_actual_key_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_chip
    ADD CONSTRAINT fg_chip_planta_actual_key_fkey FOREIGN KEY (planta_actual_key) REFERENCES public.fg_planta(key) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_chip fg_chip_producto_inventariable_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_chip
    ADD CONSTRAINT fg_chip_producto_inventariable_id_fkey FOREIGN KEY (producto_inventariable_id) REFERENCES public.fg_producto_inventariable(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_correlativo_certificado_sede fg_correlativo_certificado_sede_planta_key_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_correlativo_certificado_sede
    ADD CONSTRAINT fg_correlativo_certificado_sede_planta_key_fkey FOREIGN KEY (planta_key) REFERENCES public.fg_planta(key);


--
-- Name: fg_facturacion fg_facturacion_venta_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_facturacion
    ADD CONSTRAINT fg_facturacion_venta_id_fkey FOREIGN KEY (venta_id) REFERENCES public.fg_venta(id);


--
-- Name: fg_inventario_cantidad_movimiento fg_inventario_cantidad_movimient_producto_inventariable_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_inventario_cantidad_movimiento
    ADD CONSTRAINT fg_inventario_cantidad_movimient_producto_inventariable_id_fkey FOREIGN KEY (producto_inventariable_id) REFERENCES public.fg_producto_inventariable(id) ON DELETE RESTRICT;


--
-- Name: fg_inventario_cantidad_movimiento fg_inventario_cantidad_movimiento_operacion_detalle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_inventario_cantidad_movimiento
    ADD CONSTRAINT fg_inventario_cantidad_movimiento_operacion_detalle_id_fkey FOREIGN KEY (operacion_detalle_id) REFERENCES public.fg_operacion_detalle(id) ON DELETE RESTRICT;


--
-- Name: fg_inventario_cantidad_movimiento fg_inventario_cantidad_movimiento_planta_key_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_inventario_cantidad_movimiento
    ADD CONSTRAINT fg_inventario_cantidad_movimiento_planta_key_fkey FOREIGN KEY (planta_key) REFERENCES public.fg_planta(key) ON DELETE RESTRICT;


--
-- Name: fg_inventario_cantidad_movimiento fg_inventario_cantidad_movimiento_usuario_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_inventario_cantidad_movimiento
    ADD CONSTRAINT fg_inventario_cantidad_movimiento_usuario_fkey FOREIGN KEY (usuario) REFERENCES public.fg_usuario(username) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_nota_credito_trabajo fg_nota_credito_trabajo_certificado_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_nota_credito_trabajo
    ADD CONSTRAINT fg_nota_credito_trabajo_certificado_id_fkey FOREIGN KEY (certificado_id) REFERENCES public.fg_certificado(id) ON DELETE RESTRICT;


--
-- Name: fg_nota_credito_trabajo fg_nota_credito_trabajo_credito_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_nota_credito_trabajo
    ADD CONSTRAINT fg_nota_credito_trabajo_credito_id_fkey FOREIGN KEY (credito_id) REFERENCES public.fg_credito(id) ON DELETE RESTRICT;


--
-- Name: fg_nota_credito_trabajo fg_nota_credito_trabajo_empresa_key_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_nota_credito_trabajo
    ADD CONSTRAINT fg_nota_credito_trabajo_empresa_key_fkey FOREIGN KEY (empresa_key) REFERENCES public.fg_empresa(key) ON DELETE RESTRICT;


--
-- Name: fg_nota_credito_trabajo fg_nota_credito_trabajo_facturacion_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_nota_credito_trabajo
    ADD CONSTRAINT fg_nota_credito_trabajo_facturacion_id_fkey FOREIGN KEY (facturacion_id) REFERENCES public.fg_facturacion(id) ON DELETE RESTRICT;


--
-- Name: fg_nota_credito_trabajo fg_nota_credito_trabajo_planta_key_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_nota_credito_trabajo
    ADD CONSTRAINT fg_nota_credito_trabajo_planta_key_fkey FOREIGN KEY (planta_key) REFERENCES public.fg_planta(key) ON DELETE RESTRICT;


--
-- Name: fg_nota_credito_trabajo fg_nota_credito_trabajo_solicitud_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_nota_credito_trabajo
    ADD CONSTRAINT fg_nota_credito_trabajo_solicitud_id_fkey FOREIGN KEY (solicitud_id) REFERENCES public.fg_solicitud_operacion(id) ON DELETE RESTRICT;


--
-- Name: fg_nota_credito_trabajo fg_nota_credito_trabajo_usuario_ejecutor_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_nota_credito_trabajo
    ADD CONSTRAINT fg_nota_credito_trabajo_usuario_ejecutor_fkey FOREIGN KEY (usuario_ejecutor) REFERENCES public.fg_usuario(username) ON DELETE RESTRICT;


--
-- Name: fg_notificacion_destinatario fg_notificacion_destinatario_notificacion_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_notificacion_destinatario
    ADD CONSTRAINT fg_notificacion_destinatario_notificacion_id_fkey FOREIGN KEY (notificacion_id) REFERENCES public.fg_notificacion(id) ON DELETE CASCADE;


--
-- Name: fg_operacion_detalle_chip fg_operacion_detalle_chip_chip_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_operacion_detalle_chip
    ADD CONSTRAINT fg_operacion_detalle_chip_chip_id_fkey FOREIGN KEY (chip_id) REFERENCES public.fg_chip(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_operacion_detalle_chip fg_operacion_detalle_chip_operacion_detalle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_operacion_detalle_chip
    ADD CONSTRAINT fg_operacion_detalle_chip_operacion_detalle_id_fkey FOREIGN KEY (operacion_detalle_id) REFERENCES public.fg_operacion_detalle(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: fg_orden_pago fg_orden_pago_venta_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_orden_pago
    ADD CONSTRAINT fg_orden_pago_venta_id_fkey FOREIGN KEY (venta_id) REFERENCES public.fg_venta(id);


--
-- Name: fg_perfil_planta fg_perfil_planta_perfil_clave_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_perfil_planta
    ADD CONSTRAINT fg_perfil_planta_perfil_clave_fkey FOREIGN KEY (perfil_clave) REFERENCES public.fg_perfil(clave) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: fg_perfil_planta fg_perfil_planta_planta_key_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_perfil_planta
    ADD CONSTRAINT fg_perfil_planta_planta_key_fkey FOREIGN KEY (planta_key) REFERENCES public.fg_planta(key);


--
-- Name: fg_producto_inventariable fg_producto_inventariable_producto_facturacion_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_producto_inventariable
    ADD CONSTRAINT fg_producto_inventariable_producto_facturacion_id_fkey FOREIGN KEY (producto_facturacion_id) REFERENCES public.fg_producto_facturacion(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_producto_inventariable_sede fg_producto_inventariable_sede_planta_key_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_producto_inventariable_sede
    ADD CONSTRAINT fg_producto_inventariable_sede_planta_key_fkey FOREIGN KEY (planta_key) REFERENCES public.fg_planta(key) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_producto_inventariable_sede fg_producto_inventariable_sede_producto_inventariable_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_producto_inventariable_sede
    ADD CONSTRAINT fg_producto_inventariable_sede_producto_inventariable_id_fkey FOREIGN KEY (producto_inventariable_id) REFERENCES public.fg_producto_inventariable(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_servicio fg_servicio_formato_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_servicio
    ADD CONSTRAINT fg_servicio_formato_id_fkey FOREIGN KEY (formato_id) REFERENCES public.fg_certificado_formato(id);


--
-- Name: fg_servicio fg_servicio_tipo_certificado_clave_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_servicio
    ADD CONSTRAINT fg_servicio_tipo_certificado_clave_fkey FOREIGN KEY (tipo_certificado_clave) REFERENCES public.fg_tipo_certificado(clave);


--
-- Name: fg_venta_detalle fg_venta_detalle_chip_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_venta_detalle
    ADD CONSTRAINT fg_venta_detalle_chip_id_fkey FOREIGN KEY (chip_id) REFERENCES public.fg_chip(id);


--
-- Name: fg_venta_detalle fg_venta_detalle_producto_inventariable_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_venta_detalle
    ADD CONSTRAINT fg_venta_detalle_producto_inventariable_id_fkey FOREIGN KEY (producto_inventariable_id) REFERENCES public.fg_producto_inventariable(id);


--
-- Name: fg_venta_detalle fg_venta_detalle_venta_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_venta_detalle
    ADD CONSTRAINT fg_venta_detalle_venta_id_fkey FOREIGN KEY (venta_id) REFERENCES public.fg_venta(id) ON DELETE CASCADE;


--
-- Name: fg_auditoria_config fk_auditoria_usuario; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

-- NOTA MIGRACIÓN 005: fk_auditoria_usuario desvinculada para permitir que los
-- eventos de auditoría se conserven como snapshots históricos inmutables sin bloquear
-- la baja técnica de cuentas de usuarios.
-- ALTER TABLE ONLY public.fg_auditoria_config
--     ADD CONSTRAINT fk_auditoria_usuario FOREIGN KEY (username) REFERENCES public.fg_usuario(username);


--
-- Name: fg_certificado_conformidad fk_cert_conf_cert; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_certificado_conformidad
    ADD CONSTRAINT fk_cert_conf_cert FOREIGN KEY (certificado_id) REFERENCES public.fg_certificado(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: fg_certificado_glp fk_cert_glp_cert; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_certificado_glp
    ADD CONSTRAINT fk_cert_glp_cert FOREIGN KEY (certificado_id) REFERENCES public.fg_certificado(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: fg_certificado_glp_componente fk_cert_glp_comp_cert; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_certificado_glp_componente
    ADD CONSTRAINT fk_cert_glp_comp_cert FOREIGN KEY (certificado_id) REFERENCES public.fg_certificado_glp(certificado_id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: fg_certificado_glp fk_cert_glp_taller; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_certificado_glp
    ADD CONSTRAINT fk_cert_glp_taller FOREIGN KEY (taller_autorizado_id) REFERENCES public.fg_taller_autorizado(id) ON UPDATE CASCADE;


--
-- Name: fg_certificado_glp_verificacion fk_cert_glp_verif_cert; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_certificado_glp_verificacion
    ADD CONSTRAINT fk_cert_glp_verif_cert FOREIGN KEY (certificado_id) REFERENCES public.fg_certificado_glp(certificado_id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: fg_certificado_gnv fk_cert_gnv_cert; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_certificado_gnv
    ADD CONSTRAINT fk_cert_gnv_cert FOREIGN KEY (certificado_id) REFERENCES public.fg_certificado(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: fg_certificado_gnv fk_cert_gnv_taller; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_certificado_gnv
    ADD CONSTRAINT fk_cert_gnv_taller FOREIGN KEY (taller_autorizado_id) REFERENCES public.fg_taller_autorizado(id) ON UPDATE CASCADE;


--
-- Name: fg_certificado_gnv_verificacion fk_cert_gnv_verif_cert; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_certificado_gnv_verificacion
    ADD CONSTRAINT fk_cert_gnv_verif_cert FOREIGN KEY (certificado_id) REFERENCES public.fg_certificado_gnv(certificado_id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: fg_certificado_titular fk_cert_titular_cert; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_certificado_titular
    ADD CONSTRAINT fk_cert_titular_cert FOREIGN KEY (certificado_id) REFERENCES public.fg_certificado(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: fg_certificado_titular fk_cert_titular_cliente; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_certificado_titular
    ADD CONSTRAINT fk_cert_titular_cliente FOREIGN KEY (cliente_id) REFERENCES public.fg_cliente(id) ON UPDATE CASCADE;


--
-- Name: fg_certificado_vehiculo fk_cert_vehiculo_cert; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_certificado_vehiculo
    ADD CONSTRAINT fk_cert_vehiculo_cert FOREIGN KEY (certificado_id) REFERENCES public.fg_certificado(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: fg_certificado fk_certificado_cliente; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_certificado
    ADD CONSTRAINT fk_certificado_cliente FOREIGN KEY (cliente_id) REFERENCES public.fg_cliente(id) ON UPDATE CASCADE;


--
-- Name: fg_certificado fk_certificado_planta; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_certificado
    ADD CONSTRAINT fk_certificado_planta FOREIGN KEY (planta_key) REFERENCES public.fg_planta(key) ON UPDATE CASCADE;


--
-- Name: fg_certificado fk_certificado_tipo; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_certificado
    ADD CONSTRAINT fk_certificado_tipo FOREIGN KEY (tipo_certificado_clave) REFERENCES public.fg_tipo_certificado(clave) ON UPDATE CASCADE;


--
-- Name: fg_certificado fk_certificado_usuarioc; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_certificado
    ADD CONSTRAINT fk_certificado_usuarioc FOREIGN KEY (usuario_creacion) REFERENCES public.fg_usuario(username) ON UPDATE CASCADE;


--
-- Name: fg_certificado fk_certificado_usuariom; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_certificado
    ADD CONSTRAINT fk_certificado_usuariom FOREIGN KEY (usuario_modificacion) REFERENCES public.fg_usuario(username) ON UPDATE CASCADE;


--
-- Name: fg_correlativo_certificado fk_correlativo_planta; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_correlativo_certificado
    ADD CONSTRAINT fk_correlativo_planta FOREIGN KEY (planta_key) REFERENCES public.fg_planta(key) ON UPDATE CASCADE;


--
-- Name: fg_correlativo_certificado fk_correlativo_tipo; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_correlativo_certificado
    ADD CONSTRAINT fk_correlativo_tipo FOREIGN KEY (tipo_certificado_clave) REFERENCES public.fg_tipo_certificado(clave) ON UPDATE CASCADE;


--
-- Name: fg_documento_anulacion fk_fg_anulacion_credito; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_documento_anulacion
    ADD CONSTRAINT fk_fg_anulacion_credito FOREIGN KEY (credito_id) REFERENCES public.fg_credito(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_documento_anulacion fk_fg_anulacion_debito; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_documento_anulacion
    ADD CONSTRAINT fk_fg_anulacion_debito FOREIGN KEY (debito_id) REFERENCES public.fg_debito(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_documento_anulacion fk_fg_anulacion_facturacion; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_documento_anulacion
    ADD CONSTRAINT fk_fg_anulacion_facturacion FOREIGN KEY (facturacion_id) REFERENCES public.fg_facturacion(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_documento_anulacion fk_fg_anulacion_usuario_creacion; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_documento_anulacion
    ADD CONSTRAINT fk_fg_anulacion_usuario_creacion FOREIGN KEY (usuario_creacion) REFERENCES public.fg_usuario(username) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_documento_anulacion fk_fg_anulacion_usuario_modificacion; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_documento_anulacion
    ADD CONSTRAINT fk_fg_anulacion_usuario_modificacion FOREIGN KEY (usuario_modificacion) REFERENCES public.fg_usuario(username) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_certificado_duplicado fk_fg_certificado_duplicado_certificado; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_certificado_duplicado
    ADD CONSTRAINT fk_fg_certificado_duplicado_certificado FOREIGN KEY (certificado_original_id) REFERENCES public.fg_certificado(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_certificado_duplicado fk_fg_certificado_duplicado_facturacion; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_certificado_duplicado
    ADD CONSTRAINT fk_fg_certificado_duplicado_facturacion FOREIGN KEY (facturacion_id) REFERENCES public.fg_facturacion(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: fg_certificado_duplicado fk_fg_certificado_duplicado_operacion; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_certificado_duplicado
    ADD CONSTRAINT fk_fg_certificado_duplicado_operacion FOREIGN KEY (operacion_id) REFERENCES public.fg_operacion_comercial(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_certificado_duplicado fk_fg_certificado_duplicado_planta; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_certificado_duplicado
    ADD CONSTRAINT fk_fg_certificado_duplicado_planta FOREIGN KEY (planta_key) REFERENCES public.fg_planta(key) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_certificado_gnv fk_fg_certificado_gnv_taller_planta; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_certificado_gnv
    ADD CONSTRAINT fk_fg_certificado_gnv_taller_planta FOREIGN KEY (taller_planta_key) REFERENCES public.fg_planta(key) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_certificado fk_fg_certificado_solicitud; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_certificado
    ADD CONSTRAINT fk_fg_certificado_solicitud FOREIGN KEY (solicitud_anulacion_id) REFERENCES public.fg_solicitud_operacion(id) ON DELETE RESTRICT;


--
-- Name: fg_certificado fk_fg_certificado_usuario_anulacion; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_certificado
    ADD CONSTRAINT fk_fg_certificado_usuario_anulacion FOREIGN KEY (usuario_anulacion) REFERENCES public.fg_usuario(username) ON DELETE RESTRICT;


--
-- Name: fg_credito fk_fg_credito_empresa; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_credito
    ADD CONSTRAINT fk_fg_credito_empresa FOREIGN KEY (empresa_key) REFERENCES public.fg_empresa(key) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_credito fk_fg_credito_facturacion; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_credito
    ADD CONSTRAINT fk_fg_credito_facturacion FOREIGN KEY (facturacion_id) REFERENCES public.fg_facturacion(id) ON UPDATE CASCADE ON DELETE RESTRICT;




--
-- Name: fg_credito fk_fg_credito_planta; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_credito
    ADD CONSTRAINT fk_fg_credito_planta FOREIGN KEY (planta_key) REFERENCES public.fg_planta(key) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_credito fk_fg_credito_serie; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_credito
    ADD CONSTRAINT fk_fg_credito_serie FOREIGN KEY (serie_comprobante_id) REFERENCES public.fg_serie_comprobante(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_credito fk_fg_credito_usuario_creacion; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_credito
    ADD CONSTRAINT fk_fg_credito_usuario_creacion FOREIGN KEY (usuario_creacion) REFERENCES public.fg_usuario(username) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_credito fk_fg_credito_usuario_modificacion; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_credito
    ADD CONSTRAINT fk_fg_credito_usuario_modificacion FOREIGN KEY (usuario_modificacion) REFERENCES public.fg_usuario(username) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_debito fk_fg_debito_empresa; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_debito
    ADD CONSTRAINT fk_fg_debito_empresa FOREIGN KEY (empresa_key) REFERENCES public.fg_empresa(key) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_debito fk_fg_debito_facturacion; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_debito
    ADD CONSTRAINT fk_fg_debito_facturacion FOREIGN KEY (facturacion_id) REFERENCES public.fg_facturacion(id) ON UPDATE CASCADE ON DELETE RESTRICT;




--
-- Name: fg_debito fk_fg_debito_planta; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_debito
    ADD CONSTRAINT fk_fg_debito_planta FOREIGN KEY (planta_key) REFERENCES public.fg_planta(key) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_debito fk_fg_debito_serie; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_debito
    ADD CONSTRAINT fk_fg_debito_serie FOREIGN KEY (serie_comprobante_id) REFERENCES public.fg_serie_comprobante(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_debito fk_fg_debito_usuario_creacion; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_debito
    ADD CONSTRAINT fk_fg_debito_usuario_creacion FOREIGN KEY (usuario_creacion) REFERENCES public.fg_usuario(username) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_debito fk_fg_debito_usuario_modificacion; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_debito
    ADD CONSTRAINT fk_fg_debito_usuario_modificacion FOREIGN KEY (usuario_modificacion) REFERENCES public.fg_usuario(username) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_descuentocomprobante fk_fg_descom_cert; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_descuentocomprobante
    ADD CONSTRAINT fk_fg_descom_cert FOREIGN KEY (certificado_id) REFERENCES public.fg_certificado(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_descuentocomprobante fk_fg_descom_descli; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_descuentocomprobante
    ADD CONSTRAINT fk_fg_descom_descli FOREIGN KEY (descuento_cliente_id) REFERENCES public.fg_descuentocliente(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_descuentocomprobante fk_fg_descom_descuento; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_descuentocomprobante
    ADD CONSTRAINT fk_fg_descom_descuento FOREIGN KEY (descuento_id) REFERENCES public.fg_descuento(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_descuentocomprobante fk_fg_descom_fact; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_descuentocomprobante
    ADD CONSTRAINT fk_fg_descom_fact FOREIGN KEY (facturacion_id) REFERENCES public.fg_facturacion(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_descuentocomprobante fk_fg_descom_orden; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_descuentocomprobante
    ADD CONSTRAINT fk_fg_descom_orden FOREIGN KEY (orden_pago_id) REFERENCES public.fg_orden_pago(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_descuentocomprobante fk_fg_descom_usu_crea; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_descuentocomprobante
    ADD CONSTRAINT fk_fg_descom_usu_crea FOREIGN KEY (usuario_creacion) REFERENCES public.fg_usuario(username) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_descuentocomprobante fk_fg_descom_usu_mod; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_descuentocomprobante
    ADD CONSTRAINT fk_fg_descom_usu_mod FOREIGN KEY (usuario_modificacion) REFERENCES public.fg_usuario(username) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_descuento fk_fg_descuento_ejecutivo; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_descuento
    ADD CONSTRAINT fk_fg_descuento_ejecutivo FOREIGN KEY (ejecutivo_id) REFERENCES public.fg_ejecutivo(id) ON UPDATE CASCADE;


--
-- Name: fg_descuento fk_fg_descuento_planta; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_descuento
    ADD CONSTRAINT fk_fg_descuento_planta FOREIGN KEY (planta_key) REFERENCES public.fg_planta(key) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_descuento fk_fg_descuento_usu_crea; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_descuento
    ADD CONSTRAINT fk_fg_descuento_usu_crea FOREIGN KEY (usuario_creacion) REFERENCES public.fg_usuario(username) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_descuento fk_fg_descuento_usu_mod; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_descuento
    ADD CONSTRAINT fk_fg_descuento_usu_mod FOREIGN KEY (usuario_modificacion) REFERENCES public.fg_usuario(username) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_descuentocliente fk_fg_descuentocliente_descuento; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_descuentocliente
    ADD CONSTRAINT fk_fg_descuentocliente_descuento FOREIGN KEY (descuento_id) REFERENCES public.fg_descuento(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: fg_descuentocliente fk_fg_descuentocliente_planta; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_descuentocliente
    ADD CONSTRAINT fk_fg_descuentocliente_planta FOREIGN KEY (planta_key) REFERENCES public.fg_planta(key) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_descuentocliente fk_fg_descuentocliente_usu_crea; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_descuentocliente
    ADD CONSTRAINT fk_fg_descuentocliente_usu_crea FOREIGN KEY (usuario_creacion) REFERENCES public.fg_usuario(username) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_descuentocliente fk_fg_descuentocliente_usu_mod; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_descuentocliente
    ADD CONSTRAINT fk_fg_descuentocliente_usu_mod FOREIGN KEY (usuario_modificacion) REFERENCES public.fg_usuario(username) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_descuentodetalle fk_fg_descuentodetalle_codigo; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_descuentodetalle
    ADD CONSTRAINT fk_fg_descuentodetalle_codigo FOREIGN KEY (descuento_cliente_id) REFERENCES public.fg_descuentocliente(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: fg_descuentodetalle fk_fg_descuentodetalle_descuento; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_descuentodetalle
    ADD CONSTRAINT fk_fg_descuentodetalle_descuento FOREIGN KEY (descuento_id) REFERENCES public.fg_descuento(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: fg_descuentodetalle fk_fg_descuentodetalle_planta; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_descuentodetalle
    ADD CONSTRAINT fk_fg_descuentodetalle_planta FOREIGN KEY (planta_key) REFERENCES public.fg_planta(key) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_descuentodetalle fk_fg_descuentodetalle_servicio; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_descuentodetalle
    ADD CONSTRAINT fk_fg_descuentodetalle_servicio FOREIGN KEY (servicio_id) REFERENCES public.fg_servicio(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: fg_descuentodetalle fk_fg_descuentodetalle_usu_crea; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_descuentodetalle
    ADD CONSTRAINT fk_fg_descuentodetalle_usu_crea FOREIGN KEY (usuario_creacion) REFERENCES public.fg_usuario(username) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_descuentodetalle fk_fg_descuentodetalle_usu_mod; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_descuentodetalle
    ADD CONSTRAINT fk_fg_descuentodetalle_usu_mod FOREIGN KEY (usuario_modificacion) REFERENCES public.fg_usuario(username) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_documento_electronico_operacion fk_fg_doc_operacion_anulacion; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_documento_electronico_operacion
    ADD CONSTRAINT fk_fg_doc_operacion_anulacion FOREIGN KEY (anulacion_id) REFERENCES public.fg_documento_anulacion(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: fg_documento_electronico_operacion fk_fg_doc_operacion_credito; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_documento_electronico_operacion
    ADD CONSTRAINT fk_fg_doc_operacion_credito FOREIGN KEY (credito_id) REFERENCES public.fg_credito(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: fg_documento_electronico_operacion fk_fg_doc_operacion_debito; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_documento_electronico_operacion
    ADD CONSTRAINT fk_fg_doc_operacion_debito FOREIGN KEY (debito_id) REFERENCES public.fg_debito(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: fg_documento_electronico_operacion fk_fg_doc_operacion_facturacion; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_documento_electronico_operacion
    ADD CONSTRAINT fk_fg_doc_operacion_facturacion FOREIGN KEY (facturacion_id) REFERENCES public.fg_facturacion(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: fg_documento_electronico_operacion fk_fg_doc_operacion_usuario; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_documento_electronico_operacion
    ADD CONSTRAINT fk_fg_doc_operacion_usuario FOREIGN KEY (usuario_creacion) REFERENCES public.fg_usuario(username) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_ejecutivo fk_fg_ejecutivo_usu_crea; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_ejecutivo
    ADD CONSTRAINT fk_fg_ejecutivo_usu_crea FOREIGN KEY (usuario_creacion) REFERENCES public.fg_usuario(username) ON UPDATE CASCADE;


--
-- Name: fg_ejecutivo fk_fg_ejecutivo_usu_mod; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_ejecutivo
    ADD CONSTRAINT fk_fg_ejecutivo_usu_mod FOREIGN KEY (usuario_modificacion) REFERENCES public.fg_usuario(username) ON UPDATE CASCADE;


--
-- Name: fg_ejecutivo fk_fg_ejecutivo_usuario; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_ejecutivo
    ADD CONSTRAINT fk_fg_ejecutivo_usuario FOREIGN KEY (username) REFERENCES public.fg_usuario(username) ON UPDATE CASCADE;


--
-- Name: fg_empresa_facturador fk_fg_empresa_facturador_empresa; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_empresa_facturador
    ADD CONSTRAINT fk_fg_empresa_facturador_empresa FOREIGN KEY (empresa_key) REFERENCES public.fg_empresa(key) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_facturacion fk_fg_facturacion_certificado; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_facturacion
    ADD CONSTRAINT fk_fg_facturacion_certificado FOREIGN KEY (certificado_id) REFERENCES public.fg_certificado(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: fg_facturacion_cuota fk_fg_facturacion_cuota_facturacion; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_facturacion_cuota
    ADD CONSTRAINT fk_fg_facturacion_cuota_facturacion FOREIGN KEY (facturacion_id) REFERENCES public.fg_facturacion(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: fg_facturacion fk_fg_facturacion_empresa; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_facturacion
    ADD CONSTRAINT fk_fg_facturacion_empresa FOREIGN KEY (empresa_key) REFERENCES public.fg_empresa(key) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_facturacion_intento fk_fg_facturacion_intento_facturacion; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_facturacion_intento
    ADD CONSTRAINT fk_fg_facturacion_intento_facturacion FOREIGN KEY (facturacion_id) REFERENCES public.fg_facturacion(id) ON UPDATE CASCADE ON DELETE CASCADE;




--
-- Name: fg_facturacion fk_fg_facturacion_operacion; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_facturacion
    ADD CONSTRAINT fk_fg_facturacion_operacion FOREIGN KEY (operacion_id) REFERENCES public.fg_operacion_comercial(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_facturacion fk_fg_facturacion_planta; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_facturacion
    ADD CONSTRAINT fk_fg_facturacion_planta FOREIGN KEY (planta_key) REFERENCES public.fg_planta(key) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_facturacion fk_fg_facturacion_serie_comprobante; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_facturacion
    ADD CONSTRAINT fk_fg_facturacion_serie_comprobante FOREIGN KEY (serie_comprobante_id) REFERENCES public.fg_serie_comprobante(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_operacion_comercial fk_fg_operacion_cliente; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_operacion_comercial
    ADD CONSTRAINT fk_fg_operacion_cliente FOREIGN KEY (cliente_id) REFERENCES public.fg_cliente(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: fg_operacion_detalle fk_fg_operacion_detalle_certificado; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_operacion_detalle
    ADD CONSTRAINT fk_fg_operacion_detalle_certificado FOREIGN KEY (certificado_id) REFERENCES public.fg_certificado(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_operacion_detalle fk_fg_operacion_detalle_operacion; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_operacion_detalle
    ADD CONSTRAINT fk_fg_operacion_detalle_operacion FOREIGN KEY (operacion_id) REFERENCES public.fg_operacion_comercial(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: fg_operacion_detalle fk_fg_operacion_detalle_producto; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_operacion_detalle
    ADD CONSTRAINT fk_fg_operacion_detalle_producto FOREIGN KEY (producto_facturacion_id) REFERENCES public.fg_producto_facturacion(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_operacion_detalle fk_fg_operacion_detalle_servicio; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_operacion_detalle
    ADD CONSTRAINT fk_fg_operacion_detalle_servicio FOREIGN KEY (servicio_id) REFERENCES public.fg_servicio(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_operacion_detalle fk_fg_operacion_detalle_tarifa; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_operacion_detalle
    ADD CONSTRAINT fk_fg_operacion_detalle_tarifa FOREIGN KEY (tarifa_id) REFERENCES public.fg_tarifa(id) ON UPDATE CASCADE ON DELETE RESTRICT;




--
-- Name: fg_operacion_comercial fk_fg_operacion_planta; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_operacion_comercial
    ADD CONSTRAINT fk_fg_operacion_planta FOREIGN KEY (planta_key) REFERENCES public.fg_planta(key) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_operacion_comercial fk_fg_operacion_usuario_creacion; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_operacion_comercial
    ADD CONSTRAINT fk_fg_operacion_usuario_creacion FOREIGN KEY (usuario_creacion) REFERENCES public.fg_usuario(username) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_operacion_comercial fk_fg_operacion_usuario_modificacion; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_operacion_comercial
    ADD CONSTRAINT fk_fg_operacion_usuario_modificacion FOREIGN KEY (usuario_modificacion) REFERENCES public.fg_usuario(username) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_orden_pago fk_fg_orden_pago_certificado; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_orden_pago
    ADD CONSTRAINT fk_fg_orden_pago_certificado FOREIGN KEY (certificado_id) REFERENCES public.fg_certificado(id) ON UPDATE CASCADE ON DELETE CASCADE;






--
-- Name: fg_orden_pago fk_fg_orden_pago_operacion; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_orden_pago
    ADD CONSTRAINT fk_fg_orden_pago_operacion FOREIGN KEY (operacion_id) REFERENCES public.fg_operacion_comercial(id) ON UPDATE CASCADE ON DELETE RESTRICT;








--
-- Name: fg_pago fk_fg_pago_orden; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_pago
    ADD CONSTRAINT fk_fg_pago_orden FOREIGN KEY (orden_pago_id) REFERENCES public.fg_orden_pago(id) ON UPDATE CASCADE ON DELETE CASCADE;






--
-- Name: fg_planta fk_fg_planta_empresa; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_planta
    ADD CONSTRAINT fk_fg_planta_empresa FOREIGN KEY (empresa_key) REFERENCES public.fg_empresa(key) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_perfil_permiso fk_fg_pp_perfil; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_perfil_permiso
    ADD CONSTRAINT fk_fg_pp_perfil FOREIGN KEY (perfil_clave) REFERENCES public.fg_perfil(clave) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: fg_perfil_permiso fk_fg_pp_permiso; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_perfil_permiso
    ADD CONSTRAINT fk_fg_pp_permiso FOREIGN KEY (permiso_clave) REFERENCES public.fg_permiso(clave);


--
-- Name: fg_producto_facturacion fk_fg_producto_facturacion_categoria; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_producto_facturacion
    ADD CONSTRAINT fk_fg_producto_facturacion_categoria FOREIGN KEY (categoria_id) REFERENCES public.fg_categoria_servicio(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_producto_facturacion fk_fg_producto_facturacion_chip; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_producto_facturacion
    ADD CONSTRAINT fk_fg_producto_facturacion_chip FOREIGN KEY (producto_chip_id) REFERENCES public.fg_producto_inventariable(id) ON DELETE RESTRICT;


--
-- Name: fg_producto_inventariable_sede fk_fg_producto_inventariable_sede_producto_facturacion; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_producto_inventariable_sede
    ADD CONSTRAINT fk_fg_producto_inventariable_sede_producto_facturacion FOREIGN KEY (producto_facturacion_id) REFERENCES public.fg_producto_facturacion(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_producto_sede fk_fg_producto_sede_planta; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_producto_sede
    ADD CONSTRAINT fk_fg_producto_sede_planta FOREIGN KEY (planta_key) REFERENCES public.fg_planta(key) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_producto_sede fk_fg_producto_sede_producto; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_producto_sede
    ADD CONSTRAINT fk_fg_producto_sede_producto FOREIGN KEY (producto_facturacion_id) REFERENCES public.fg_producto_facturacion(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_serie_comprobante fk_fg_serie_comprobante_planta; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_serie_comprobante
    ADD CONSTRAINT fk_fg_serie_comprobante_planta FOREIGN KEY (planta_key) REFERENCES public.fg_planta(key) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_serie_comprobante fk_fg_serie_empresa; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_serie_comprobante
    ADD CONSTRAINT fk_fg_serie_empresa FOREIGN KEY (empresa_key) REFERENCES public.fg_empresa(key) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_servicio fk_fg_servicio_categoria; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_servicio
    ADD CONSTRAINT fk_fg_servicio_categoria FOREIGN KEY (categoria_id) REFERENCES public.fg_categoria_servicio(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_solicitud_operacion fk_fg_solicitud_certificado; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_solicitud_operacion
    ADD CONSTRAINT fk_fg_solicitud_certificado FOREIGN KEY (certificado_id) REFERENCES public.fg_certificado(id) ON DELETE RESTRICT;


--
-- Name: fg_solicitud_operacion fk_fg_solicitud_decisor; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_solicitud_operacion
    ADD CONSTRAINT fk_fg_solicitud_decisor FOREIGN KEY (usuario_decision) REFERENCES public.fg_usuario(username) ON DELETE RESTRICT;


--
-- Name: fg_solicitud_operacion fk_fg_solicitud_ejecutor; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_solicitud_operacion
    ADD CONSTRAINT fk_fg_solicitud_ejecutor FOREIGN KEY (usuario_ejecucion) REFERENCES public.fg_usuario(username) ON DELETE RESTRICT;


--
-- Name: fg_solicitud_operacion fk_fg_solicitud_empresa; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_solicitud_operacion
    ADD CONSTRAINT fk_fg_solicitud_empresa FOREIGN KEY (empresa_key) REFERENCES public.fg_empresa(key) ON DELETE RESTRICT;


--
-- Name: fg_solicitud_operacion_evento fk_fg_solicitud_evento_solicitud; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_solicitud_operacion_evento
    ADD CONSTRAINT fk_fg_solicitud_evento_solicitud FOREIGN KEY (solicitud_id) REFERENCES public.fg_solicitud_operacion(id) ON DELETE RESTRICT;


--
-- Name: fg_solicitud_operacion_evento fk_fg_solicitud_evento_usuario; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_solicitud_operacion_evento
    ADD CONSTRAINT fk_fg_solicitud_evento_usuario FOREIGN KEY (usuario_responsable) REFERENCES public.fg_usuario(username) ON DELETE RESTRICT;


--
-- Name: fg_solicitud_operacion fk_fg_solicitud_facturacion; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_solicitud_operacion
    ADD CONSTRAINT fk_fg_solicitud_facturacion FOREIGN KEY (facturacion_id) REFERENCES public.fg_facturacion(id) ON DELETE RESTRICT;


--
-- Name: fg_solicitud_operacion fk_fg_solicitud_planta; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_solicitud_operacion
    ADD CONSTRAINT fk_fg_solicitud_planta FOREIGN KEY (planta_key) REFERENCES public.fg_planta(key) ON DELETE RESTRICT;


--
-- Name: fg_solicitud_operacion fk_fg_solicitud_solicitante; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_solicitud_operacion
    ADD CONSTRAINT fk_fg_solicitud_solicitante FOREIGN KEY (usuario_solicitante) REFERENCES public.fg_usuario(username) ON DELETE RESTRICT;


--
-- Name: fg_taller_autorizado fk_fg_taller_autorizado_planta; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_taller_autorizado
    ADD CONSTRAINT fk_fg_taller_autorizado_planta FOREIGN KEY (planta_key) REFERENCES public.fg_planta(key) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_tarifa fk_fg_tarifa_planta; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_tarifa
    ADD CONSTRAINT fk_fg_tarifa_planta FOREIGN KEY (planta_key) REFERENCES public.fg_planta(key);


--
-- Name: fg_tarifa fk_fg_tarifa_producto_facturacion; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_tarifa
    ADD CONSTRAINT fk_fg_tarifa_producto_facturacion FOREIGN KEY (producto_facturacion_id) REFERENCES public.fg_producto_facturacion(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_tarifa fk_fg_tarifa_servicio; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_tarifa
    ADD CONSTRAINT fk_fg_tarifa_servicio FOREIGN KEY (servicio_id) REFERENCES public.fg_servicio(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_usuario_planta fk_fg_up_planta; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_usuario_planta
    ADD CONSTRAINT fk_fg_up_planta FOREIGN KEY (plantas_key) REFERENCES public.fg_planta(key);


--
-- Name: fg_usuario_planta fk_fg_up_usuario; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_usuario_planta
    ADD CONSTRAINT fk_fg_up_usuario FOREIGN KEY (usuario_username) REFERENCES public.fg_usuario(username) ON UPDATE CASCADE;


--
-- Name: fg_usuario_sesion fk_fg_us_planta; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_usuario_sesion
    ADD CONSTRAINT fk_fg_us_planta FOREIGN KEY (planta_key) REFERENCES public.fg_planta(key);


--
-- Name: fg_usuario_sesion fk_fg_us_usuario; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_usuario_sesion
    ADD CONSTRAINT fk_fg_us_usuario FOREIGN KEY (usuario_username) REFERENCES public.fg_usuario(username) ON UPDATE CASCADE;


--
-- Name: fg_usuario fk_fg_usuario_perfil; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_usuario
    ADD CONSTRAINT fk_fg_usuario_perfil FOREIGN KEY (perfil_id) REFERENCES public.fg_perfil(clave);




--
-- Name: fg_vehiculo fk_fg_vehiculo_certificado_origen; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_vehiculo
    ADD CONSTRAINT fk_fg_vehiculo_certificado_origen FOREIGN KEY (certificado_origen_id) REFERENCES public.fg_certificado(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: fg_vehiculo fk_fg_vehiculo_usuario_creacion; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_vehiculo
    ADD CONSTRAINT fk_fg_vehiculo_usuario_creacion FOREIGN KEY (usuario_creacion) REFERENCES public.fg_usuario(username) ON UPDATE CASCADE;


--
-- Name: fg_vehiculo fk_fg_vehiculo_usuario_modificacion; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_vehiculo
    ADD CONSTRAINT fk_fg_vehiculo_usuario_modificacion FOREIGN KEY (usuario_modificacion) REFERENCES public.fg_usuario(username) ON UPDATE CASCADE;


--
-- PostgreSQL database dump complete
--




--
-- Name: fg_usuario_perfil; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fg_usuario_perfil (
    usuario_username character varying(255) NOT NULL,
    tipo_documento_key character varying(20) NOT NULL,
    nro_documento character varying(20) NOT NULL,
    nombres character varying(200),
    apellidos character varying(200),
    nombre_razon_social character varying(500),
    pais_key character varying(20),
    departamento_key character varying(20),
    provincia_key character varying(20),
    distrito_key character varying(20),
    direccion character varying(500),
    email character varying(150),
    telefono character varying(100),
    persona_contacto character varying(255),
    fecha_creacion timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    fecha_actualizacion timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

ALTER TABLE ONLY public.fg_usuario_perfil
    ADD CONSTRAINT fg_usuario_perfil_pkey PRIMARY KEY (usuario_username);

ALTER TABLE ONLY public.fg_usuario_perfil
    ADD CONSTRAINT uq_fg_usuario_perfil_documento UNIQUE (tipo_documento_key, nro_documento);

CREATE INDEX idx_fg_usuario_perfil_nombre ON public.fg_usuario_perfil USING btree (nombre_razon_social, apellidos, nombres);

ALTER TABLE ONLY public.fg_usuario_perfil
    ADD CONSTRAINT fk_fg_usuario_perfil_usuario FOREIGN KEY (usuario_username) REFERENCES public.fg_usuario(username) ON UPDATE CASCADE ON DELETE CASCADE;


-- ============================================================================
-- 9. SECCIÓN: DEPENDENCIAS Y CLAVES FORÁNEAS EXTERNAS HACIA FARENET

ALTER TABLE ONLY public.fg_chip_codigo_reserva
    ADD CONSTRAINT fk_fg_chip_codigo_reserva_producto
    FOREIGN KEY (producto_inventariable_id)
    REFERENCES public.fg_producto_inventariable(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.fg_chip_codigo_reserva
    ADD CONSTRAINT fk_fg_chip_codigo_reserva_planta
    FOREIGN KEY (planta_key)
    REFERENCES public.fg_planta(key) ON DELETE CASCADE;
-- ============================================================================

-- ============================================================================
-- PROTECCIÓN DE ESTRUCTURAS Y CATÁLOGOS DE FARENET:
-- En la base compartida de producción 'inspeccion', FAREGAS TIENE ESTRICTAMENTE
-- PROHIBIDO crear, alterar o eliminar estructuras pertenecientes a FARENET.
-- Los catálogos ya existen y son administrados exclusivamente por FARENET.
-- Solo en entornos de prueba de laboratorio vacíos (bases de prueba sin esquema
-- previo de FARENET), se provisionan contratos mínimos para satisfacer claves foráneas.
-- ============================================================================
IF current_database() = 'inspeccion' THEN
    IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'moneda') THEN
        RAISE EXCEPTION 'Protección FARENET: El catálogo public.moneda debe existir previamente en inspeccion.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'persona') THEN
        RAISE EXCEPTION 'Protección FARENET: La tabla public.persona debe existir previamente en inspeccion.';
    END IF;
    RAISE NOTICE 'Protección FARENET verificada: Base inspeccion detectada, se omite cualquier DDL sobre catálogos de FARENET.';
ELSE
-- Las tablas a continuación corresponden a catálogos maestros alojados en FARENET
-- Los siete primeros son destinos de FK. Los catálogos de identidad y geografía
-- soportan Usuarios. El contrato de seriedocumentobase soporta la consulta de series.
-- Cada CREATE IF NOT EXISTS evita modificar catálogos ya provisionados. No se insertan filas
-- en estas tablas. Los contratos para login unificado y maestros legacy se documentan aparte.

CREATE TABLE IF NOT EXISTS public.moneda (
    key character varying(20) PRIMARY KEY,
    nombre character varying(75),
    simbolo character varying(5),
    codigosunat character varying(3),
    descripcion character varying(100),
    activo boolean DEFAULT true
);

CREATE TABLE IF NOT EXISTS public.formapago (
    key character varying(20) PRIMARY KEY,
    nombre character varying(200),
    descripcion character varying(100),
    activo boolean DEFAULT true
);

CREATE TABLE IF NOT EXISTS public.cuentacorriente (
    key character varying(20) PRIMARY KEY,
    nroctacorriente character varying(50),
    entidadfinanciera_key character varying(20),
    moneda_key character varying(20),
    empresa_key character varying(10),
    descripcion character varying(150),
    activo boolean DEFAULT true
);

CREATE TABLE IF NOT EXISTS public.entidadfinanciera (
    key character varying(20) PRIMARY KEY,
    nombre character varying(75),
    descripcion character varying(150),
    activo boolean DEFAULT true
);

CREATE TABLE IF NOT EXISTS public.tarjeta (
    key character varying(20) PRIMARY KEY,
    nombre character varying(150),
    descripcion character varying(100),
    activo boolean DEFAULT true
);

CREATE TABLE IF NOT EXISTS public.tipocontado (
    key character varying(20) PRIMARY KEY,
    nombre character varying(200),
    descripcion character varying(100),
    activo boolean DEFAULT true
);

CREATE TABLE IF NOT EXISTS public.persona (
    nrodocumentoidentidad character varying(20) PRIMARY KEY,
    estado boolean,
    nombres character varying(200),
    apellidos character varying(200),
    nombrerazonsocial character varying(500),
    tipodocumentoidentidad_key character varying(20),
    direccion character varying(500),
    telefono character varying(100),
    email character varying(150),
    persona_contacto character varying(250),
    pais_key character varying(20),
    departamento_key character varying(20),
    provincia_key character varying(20),
    distrito_key character varying(20),
    razonsocial character varying(300)
);

CREATE TABLE IF NOT EXISTS public.tipodocumentoidentidad (
    key character varying(20) PRIMARY KEY,
    nombre character varying(75),
    codigosunat character varying(1)
);

CREATE TABLE IF NOT EXISTS public.pais (
    key character varying(20) PRIMARY KEY,
    nombre character varying(75)
);

CREATE TABLE IF NOT EXISTS public.departamento (
    key character varying(20) PRIMARY KEY,
    nombre character varying(75),
    pais_key character varying(20)
);

CREATE TABLE IF NOT EXISTS public.provincia (
    key character varying(20) PRIMARY KEY,
    nombre character varying(200),
    departamento_key character varying(20)
);

CREATE TABLE IF NOT EXISTS public.distrito (
    key character varying(20) PRIMARY KEY,
    nombre character varying(75),
    provincia_key character varying(20)
);

CREATE TABLE IF NOT EXISTS public.seriedocumentobase (
    id bigint PRIMARY KEY,
    planta_key character varying(20),
    estado boolean,
    serieboleta character varying(150),
    seriefactura character varying(150),
    serienotacreditofactura character varying(255),
    serienotacreditoboleta character varying(150),
    nroactualfactura bigint,
    nroactualboleta bigint,
    nroactualnotacreditofactura bigint,
    nroactualnotacreditoboleta bigint
);

-- ----------------------------------------------------------------------------
-- CLAVES FORÁNEAS EXTERNAS (12 FKs HACIA CATÁLOGOS COMPARTIDOS)
-- ----------------------------------------------------------------------------
--
-- Name: fg_credito fk_fg_credito_moneda; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--


END IF;
ALTER TABLE ONLY public.fg_credito
    ADD CONSTRAINT fk_fg_credito_moneda FOREIGN KEY (moneda_key) REFERENCES public.moneda(key) ON UPDATE CASCADE ON DELETE RESTRICT;

--
-- Name: fg_debito fk_fg_debito_moneda; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_debito
    ADD CONSTRAINT fk_fg_debito_moneda FOREIGN KEY (moneda_key) REFERENCES public.moneda(key) ON UPDATE CASCADE ON DELETE RESTRICT;

--
-- Name: fg_facturacion fk_fg_facturacion_moneda; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_facturacion
    ADD CONSTRAINT fk_fg_facturacion_moneda FOREIGN KEY (moneda_key) REFERENCES public.moneda(key) ON UPDATE CASCADE;

--
-- Name: fg_operacion_comercial fk_fg_operacion_moneda; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_operacion_comercial
    ADD CONSTRAINT fk_fg_operacion_moneda FOREIGN KEY (moneda_key) REFERENCES public.moneda(key) ON UPDATE CASCADE ON DELETE RESTRICT;

--
-- Name: fg_orden_pago fk_fg_orden_pago_formapago; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_orden_pago
    ADD CONSTRAINT fk_fg_orden_pago_formapago FOREIGN KEY (formapago_key) REFERENCES public.formapago(key) ON UPDATE CASCADE ON DELETE RESTRICT;

--
-- Name: fg_orden_pago fk_fg_orden_pago_moneda; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_orden_pago
    ADD CONSTRAINT fk_fg_orden_pago_moneda FOREIGN KEY (moneda_key) REFERENCES public.moneda(key) ON UPDATE CASCADE ON DELETE RESTRICT;

--
-- Name: fg_pago fk_fg_pago_cuenta; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_pago
    ADD CONSTRAINT fk_fg_pago_cuenta FOREIGN KEY (cuentacorriente_key) REFERENCES public.cuentacorriente(key) ON UPDATE CASCADE ON DELETE RESTRICT;

--
-- Name: fg_pago fk_fg_pago_entidad; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_pago
    ADD CONSTRAINT fk_fg_pago_entidad FOREIGN KEY (entidadfinanciera_key) REFERENCES public.entidadfinanciera(key) ON UPDATE CASCADE ON DELETE RESTRICT;

--
-- Name: fg_pago fk_fg_pago_moneda; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_pago
    ADD CONSTRAINT fk_fg_pago_moneda FOREIGN KEY (moneda_key) REFERENCES public.moneda(key) ON UPDATE CASCADE ON DELETE RESTRICT;

--
-- Name: fg_pago fk_fg_pago_tarjeta; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_pago
    ADD CONSTRAINT fk_fg_pago_tarjeta FOREIGN KEY (tarjeta_key) REFERENCES public.tarjeta(key) ON UPDATE CASCADE ON DELETE RESTRICT;

--
-- Name: fg_pago fk_fg_pago_tipo_contado; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_pago
    ADD CONSTRAINT fk_fg_pago_tipo_contado FOREIGN KEY (tipocontado_key) REFERENCES public.tipocontado(key) ON UPDATE CASCADE ON DELETE RESTRICT;

--
-- Name: fg_usuario fk_fg_usuario_persona; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fg_usuario
    ADD CONSTRAINT fk_fg_usuario_persona FOREIGN KEY (persona_nrodocumentoidentidad) REFERENCES public.persona(nrodocumentoidentidad) ON UPDATE CASCADE ON DELETE SET NULL;


        RAISE NOTICE 'Esquema base 000 de FAREGAS instalado exitosamente.';
    ELSE
        RAISE NOTICE 'Sección 000: El esquema base fg_* ya se encuentra instalado. Se conservan estructuras existentes.';
    END IF;
END;
$faregas_schema_000$;

-- Asegurar tablas operativas de notas de crédito y notificaciones en bases que ya tenían el esquema base 000 histórico
DO $faregas_notificaciones_patch$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'fg_nota_credito_trabajo') THEN
        CREATE TABLE public.fg_nota_credito_trabajo (
            id bigint NOT NULL,
            solicitud_id bigint NOT NULL,
            certificado_id bigint NOT NULL,
            facturacion_id bigint NOT NULL,
            credito_id bigint,
            empresa_key character varying(40) NOT NULL,
            planta_key character varying(40) NOT NULL,
            motivo_codigo character varying(2) NOT NULL,
            sustento_aprobado text NOT NULL,
            datos_aprobados jsonb DEFAULT '{}'::jsonb NOT NULL,
            estado character varying(30) DEFAULT 'EN_COLA'::character varying NOT NULL,
            intentos integer DEFAULT 0 NOT NULL,
            disponible_desde timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
            propietario_bloqueo uuid,
            bloqueo_hasta timestamp with time zone,
            usuario_ejecutor character varying(255) NOT NULL,
            ultimo_error_codigo character varying(100),
            ultimo_error_mensaje text,
            resultado jsonb,
            fecha_creacion timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
            fecha_modificacion timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
            fecha_inicio timestamp with time zone,
            fecha_finalizacion timestamp with time zone,
            CONSTRAINT ck_fg_nota_credito_trabajo_estado CHECK (((estado)::text = ANY ((ARRAY['EN_COLA'::character varying, 'ESPERANDO_COMPROBANTE'::character varying, 'EMITIENDO'::character varying, 'PENDIENTE_SUNAT'::character varying, 'ACEPTADA'::character varying, 'RECHAZADA'::character varying, 'BLOQUEADA'::character varying, 'RESULTADO_INCIERTO'::character varying, 'ERROR'::character varying])::text[]))),
            CONSTRAINT ck_fg_nota_credito_trabajo_intentos CHECK ((intentos >= 0)),
            CONSTRAINT ck_fg_nota_credito_trabajo_motivo CHECK (((motivo_codigo)::text = ANY ((ARRAY['01'::character varying, '02'::character varying, '03'::character varying])::text[])))
        );
        ALTER TABLE public.fg_nota_credito_trabajo ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
            SEQUENCE NAME public.fg_nota_credito_trabajo_id_seq START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1
        );
        ALTER TABLE ONLY public.fg_nota_credito_trabajo ADD CONSTRAINT fg_nota_credito_trabajo_pkey PRIMARY KEY (id);
        ALTER TABLE ONLY public.fg_nota_credito_trabajo ADD CONSTRAINT uq_fg_nota_credito_trabajo_solicitud UNIQUE (solicitud_id);
        CREATE INDEX IF NOT EXISTS idx_fg_nota_credito_trabajo_bloqueo ON public.fg_nota_credito_trabajo (bloqueo_hasta) WHERE (estado = 'EMITIENDO');
        CREATE INDEX IF NOT EXISTS idx_fg_nota_credito_trabajo_pendiente ON public.fg_nota_credito_trabajo (estado, disponible_desde, id) WHERE (estado IN ('EN_COLA', 'ESPERANDO_COMPROBANTE', 'PENDIENTE_SUNAT', 'RESULTADO_INCIERTO', 'ERROR'));
        RAISE NOTICE 'Tabla fg_nota_credito_trabajo creada exitosamente.';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'fg_notificacion') THEN
        CREATE TABLE public.fg_notificacion (
            id bigint NOT NULL,
            evento_clave character varying(80) NOT NULL,
            tipo character varying(40) NOT NULL,
            titulo character varying(160) NOT NULL,
            mensaje character varying(500) NOT NULL,
            planta_key character varying(80),
            empresa_key character varying(80),
            entidad_tipo character varying(60),
            entidad_id bigint,
            destino_navegacion character varying(200),
            fecha_creacion timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
            creado_por character varying(80)
        );
        ALTER TABLE public.fg_notificacion ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
            SEQUENCE NAME public.fg_notificacion_id_seq START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1
        );
        ALTER TABLE ONLY public.fg_notificacion ADD CONSTRAINT fg_notificacion_pkey PRIMARY KEY (id);
        CREATE INDEX IF NOT EXISTS idx_fg_notificacion_evento ON public.fg_notificacion (evento_clave);
        RAISE NOTICE 'Tabla fg_notificacion creada exitosamente.';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'fg_notificacion_destinatario') THEN
        CREATE TABLE public.fg_notificacion_destinatario (
            id bigint NOT NULL,
            notificacion_id bigint NOT NULL,
            usuario_id bigint NOT NULL,
            leido boolean DEFAULT false NOT NULL,
            fecha_leido timestamp with time zone
        );
        ALTER TABLE public.fg_notificacion_destinatario ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
            SEQUENCE NAME public.fg_notificacion_destinatario_id_seq START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1
        );
        ALTER TABLE ONLY public.fg_notificacion_destinatario ADD CONSTRAINT fg_notificacion_destinatario_pkey PRIMARY KEY (id);
        ALTER TABLE ONLY public.fg_notificacion_destinatario ADD CONSTRAINT uq_fg_notificacion_destinatario UNIQUE (notificacion_id, usuario_id);
        CREATE INDEX IF NOT EXISTS idx_fg_notificacion_destinatario_usuario ON public.fg_notificacion_destinatario (usuario_id, leido);
        RAISE NOTICE 'Tabla fg_notificacion_destinatario creada exitosamente.';
    END IF;
END;
$faregas_notificaciones_patch$;

-- =============================================================================
-- SECCIÓN 8: CATÁLOGOS Y DATOS INICIALES
-- =============================================================================
-- ==== migrations/001_faregas_datos_iniciales.sql ====
-- ============================================================================
-- ARCHIVO: 001_faregas_datos_iniciales.sql
-- MÓDULO: FAREGAS (Catálogos Iniciales y Configuración Base del Sistema)
-- DESTINO: Carga de catálogos mínimos indispensables para base independiente
-- MOTOR: PostgreSQL 13 o superior
-- CODIFICACIÓN: UTF-8
--
-- ADVERTENCIA OBLIGATORIA:
-- ESTE ARCHIVO NO CONTIENE DATOS SENSIBLES, NI CLIENTES REALES, NI VENTAS,
-- NI FACTURAS, NI CONSTRASEÑAS REALES DE USUARIOS.
-- SU PROPÓSITO ES PROVEER LOS CATÁLOGOS TÉCNICOS Y REGLAS RBAC ESENCIALES
-- PARA QUE LA APLICACIÓN OPERE DESDE SU PRIMER DESPLIEGUE.
--
-- CARACTERÍSTICA DE IDEMPOTENCIA:
-- TODAS LAS SENTENCIAS UTILIZAN 'ON CONFLICT DO NOTHING' O 'ON CONFLICT DO UPDATE'
-- PERMITIENDO RE-EJECUCIONES SEGURAS SIN PRODUCIR DUPLICADOS NI ERRORES.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. CATÁLOGO DE PERFILES (fg_perfil)
-- Incluye perfiles nominales estándar y perfiles operativos compatibles
-- ----------------------------------------------------------------------------
INSERT INTO public.fg_perfil (clave, nombre, visible)
VALUES
    ('ADMINISTRADOR', 'ADMINISTRADOR', TRUE),
    ('AMINISTRADOR', 'ADMINISTRADOR', TRUE),
    ('CAJERO', 'CAJERO', TRUE),
    ('CERTIFICADOR', 'CERTIFICADOR', TRUE),
    ('CONSULTA', 'CONSULTA', TRUE),
    ('CONTADOR', 'CONTADOR', TRUE),
    ('JEFE_PLANTA', 'Jefe de Planta', TRUE),
    ('OPERADOR', 'operador/emisor/ventas', TRUE),
    ('SISTEMAS', 'Sistemas', TRUE),
    ('SUPERVISOR', 'SUPERVISOR', TRUE),
    ('TALLER', 'TALLER', TRUE)
ON CONFLICT (clave) DO UPDATE
SET nombre = EXCLUDED.nombre, visible = EXCLUDED.visible;

-- ----------------------------------------------------------------------------
-- 2. CATÁLOGO DE PERMISOS DEL SISTEMA (51 PERMISOS AUDITADOS)
-- ----------------------------------------------------------------------------
INSERT INTO public.fg_permiso (clave, nombre, modulo, descripcion, activo)
VALUES
    ('CHIPS_BAJA', 'Dar de baja chips', 'FAREGAS', 'Dar de baja chips disponibles', TRUE),
    ('CHIPS_CONFIGURAR', 'Configurar productos inventariables', 'FAREGAS', 'Crear y editar productos inventariables y su disponibilidad por sede', TRUE),
    ('CHIPS_INGRESAR', 'Ingresar chips al inventario', 'FAREGAS', 'Registrar compras y stock inicial de chips', TRUE),
    ('CHIPS_TRANSFERIR', 'Transferir chips entre sedes', 'FAREGAS', 'Transferir chips disponibles a otras sedes autorizadas', TRUE),
    ('CHIPS_VENDER', 'Vender chips sueltos', 'FAREGAS', 'Vender chips a talleres autorizados', TRUE),
    ('CHIPS_VER', 'Consultar inventario de chips', 'FAREGAS', 'Ver stock y movimientos de chips en las sedes asignadas', TRUE),
    ('CONFIGURACION_CATEGORIAS', 'Configurar categorías', 'FAREGAS', 'Administrar categorías de servicios', TRUE),
    ('CONFIGURACION_EMPRESAS', 'Configurar empresas', 'FAREGAS', 'Administrar empresas emisoras y facturadores', TRUE),
    ('CONFIGURACION_PRODUCTOS', 'Configurar productos', 'FAREGAS', 'Administrar productos de facturación y mapeos DMS', TRUE),
    ('CONFIGURACION_SEDES', 'Configurar sedes', 'FAREGAS', 'Administrar configuración operativa de sedes', TRUE),
    ('CONFIGURACION_SERIES', 'Configurar series', 'FAREGAS', 'Administrar series de comprobantes por sede y tipo', TRUE),
    ('CONFIGURACION_SERVICIOS', 'Configurar servicios', 'FAREGAS', 'Administrar servicios prestados en sedes', TRUE),
    ('CONFIGURACION_TARIFAS', 'Configurar tarifas', 'FAREGAS', 'Administrar tarifas y precios por sede', TRUE),
    ('DASHBOARD_EXPORTAR', 'Exportar métricas de gestión', 'FAREGAS', 'Exportar reportes del panel de control de FAREGAS', TRUE),
    ('DASHBOARD_GLOBAL', 'Ver métricas de todas las sedes', 'FAREGAS', 'Acceder a métricas consolidadas de todas las sedes en el dashboard', TRUE),
    ('DASHBOARD_SEDE', 'Ver métricas de sedes asignadas', 'FAREGAS', 'Acceder a métricas de las sedes asignadas en el dashboard', TRUE),
    ('DESCUENTOS_ADMINISTRAR', 'Administrar descuentos comerciales', 'FAREGAS', 'Crear, editar y activar reglas comerciales de descuento y convenios', TRUE),
    ('FAREGAS_ANULAR_COMPROBANTE', 'Anular comprobante electrónico FAREGAS', 'FAREGAS', 'Permite iniciar la baja fiscal de comprobantes electrónicos FAREGAS; no incluye rectificaciones ni notas de crédito.', TRUE),
    ('FAREGAS_CERTIFICADO_ANULAR_EJECUTAR', 'Ejecutar anulación técnica de certificado', 'FAREGAS', 'Aplica en base de datos la anulación técnica del certificado luego de verificaciones fiscales y de flujo.', TRUE),
    ('FAREGAS_CERTIFICADO_RECTIFICAR_EJECUTAR', 'Ejecutar rectificación técnica de certificado', 'FAREGAS', 'Aplica la versión rectificada vigente del certificado manteniendo el histórico inmutable.', TRUE),
    ('FAREGAS_NOTA_CREDITO', 'Emitir nota de crédito', 'FAREGAS', 'Permite preparar y emitir notas de crédito electrónicas vinculadas a comprobantes de FAREGAS.', TRUE),
    ('FAREGAS_NOTA_CREDITO_APROBAR', 'Aprobar solicitudes de nota de crédito', 'FAREGAS', 'Permite aprobar solicitudes de nota de crédito creadas por sedes u operadores.', TRUE),
    ('FAREGAS_NOTA_CREDITO_AUTOAPROBAR', 'Aprobación automática de nota de crédito', 'FAREGAS', 'Permite que notas de crédito bajo umbral o reglas específicas no requieran aprobación de un tercero.', TRUE),
    ('FAREGAS_NOTIFICACION_CORTESIA_RECIBIR', 'Recibir notificaciones de cortesías', 'FAREGAS', 'Recibe avisos informativos cuando se emite una cortesía en una sede autorizada. No autoriza a emitir cortesías.', TRUE),
    ('FAREGAS_SOLICITUD_ADMINISTRAR', 'Administrar panel de solicitudes operativas', 'FAREGAS', 'Acceso a la bandeja global de solicitudes de anulación, rectificación y notas de crédito.', TRUE),
    ('FAREGAS_SOLICITUD_APROBAR', 'Aprobar solicitudes operativas', 'FAREGAS', 'Permite autorizar formalmente una solicitud de anulación o rectificación.', TRUE),
    ('FAREGAS_SOLICITUD_AUTOAPROBAR', 'Auto-aprobar solicitudes propias', 'FAREGAS', 'Permite auto-aprobar solicitudes creadas por el mismo usuario cuando la regla lo permite.', TRUE),
    ('FAREGAS_SOLICITUD_AUTOEJECUTAR', 'Auto-ejecutar solicitudes aprobadas', 'FAREGAS', 'Permite disparar la ejecución automática tras la aprobación sin intervención adicional.', TRUE),
    ('FAREGAS_SOLICITUD_CREAR', 'Crear solicitudes administrativas', 'FAREGAS', 'Permite a un operador crear solicitudes de anulación, rectificación o nota de crédito.', TRUE),
    ('FAREGAS_SOLICITUD_RECHAZAR', 'Rechazar solicitudes operativas', 'FAREGAS', 'Permite desestimar o rechazar solicitudes pendientes de aprobación.', TRUE),
    ('FAREGAS_SOLICITUD_VER', 'Consultar solicitudes operativas', 'FAREGAS', 'Ver el estado, historial y trazabilidad de solicitudes de su sede o ámbito.', TRUE),
    ('MENU_AUDITORIA', 'Menú Auditoría', 'FAREGAS', 'Acceso al módulo de auditoría de accesos y operaciones', TRUE),
    ('MENU_CHIPS', 'Menú Chips', 'FAREGAS', 'Acceso al módulo principal de control de chips', TRUE),
    ('MENU_CHIPS_INVENTARIO', 'Submenú Inventario Chips', 'FAREGAS', 'Acceso a inventario y stock físico de chips', TRUE),
    ('MENU_CHIPS_TIPOS', 'Submenú Tipos de Chip', 'FAREGAS', 'Acceso a tipos y especificaciones técnicas de chips', TRUE),
    ('MENU_CHIPS_VENTAS', 'Submenú Ventas Chips', 'FAREGAS', 'Acceso al registro de venta de chips sueltos', TRUE),
    ('MENU_CONFIGURACION', 'Menú Configuración', 'FAREGAS', 'Acceso al menú principal de configuración', TRUE),
    ('MENU_CONFIGURACION_CATALOGO', 'Submenú Catálogo', 'FAREGAS', 'Acceso a catálogos operativos del sistema', TRUE),
    ('MENU_CONFIGURACION_CORRELATIVOS', 'Submenú Correlativos', 'FAREGAS', 'Acceso a correlativos y series de certificados', TRUE),
    ('MENU_CONFIGURACION_EMPRESAS', 'Submenú Empresas', 'FAREGAS', 'Acceso a configuración de empresas y facturadores', TRUE),
    ('MENU_CONFIGURACION_SEDES', 'Submenú Sedes', 'FAREGAS', 'Acceso a administración de sedes y plantas', TRUE),
    ('MENU_CONFIGURACION_TARIFAS', 'Submenú Tarifas', 'FAREGAS', 'Acceso a configuración de tarifas y precios', TRUE),
    ('MENU_DASHBOARD', 'Menú Dashboard', 'FAREGAS', 'Acceso al panel de control y analítica', TRUE),
    ('MENU_DESCUENTOS', 'Menú Descuentos', 'FAREGAS', 'Acceso al módulo de descuentos comerciales y cortesías', TRUE),
    ('MENU_FACTURACION', 'Menú Facturación', 'FAREGAS', 'Acceso al módulo principal de facturación electrónica', TRUE),
    ('MENU_FACTURACION_CLIENTES', 'Submenú Clientes Facturación', 'FAREGAS', 'Acceso a clientes locales de facturación', TRUE),
    ('MENU_FACTURACION_COMPROBANTES', 'Submenú Comprobantes', 'FAREGAS', 'Acceso a comprobantes emitidos y notas de crédito', TRUE),
    ('MENU_FACTURACION_PREPARACION', 'Submenú Preparación Facturación', 'FAREGAS', 'Acceso al flujo de preparación de comprobantes', TRUE),
    ('MENU_FACTURACION_SERIES', 'Submenú Series Facturación', 'FAREGAS', 'Acceso a series de comprobantes electrónicos', TRUE),
    ('MENU_INICIO', 'Menú Inicio', 'FAREGAS', 'Acceso a la pantalla principal del sistema', TRUE),
    ('MENU_USUARIOS', 'Menú Usuarios', 'FAREGAS', 'Acceso a la gestión de usuarios y perfiles', TRUE)
ON CONFLICT (clave) DO UPDATE
SET nombre = EXCLUDED.nombre,
    modulo = EXCLUDED.modulo,
    descripcion = EXCLUDED.descripcion,
    activo = EXCLUDED.activo;

-- ----------------------------------------------------------------------------
-- 3. ASIGNACIONES DE PERMISOS A PERFILES (fg_perfil_permiso)
-- Matriz auditada extraída de inspeccion
-- ----------------------------------------------------------------------------
INSERT INTO public.fg_perfil_permiso (perfil_clave, permiso_clave)
VALUES
    ('AMINISTRADOR', 'CHIPS_BAJA'),
    ('AMINISTRADOR', 'CHIPS_CONFIGURAR'),
    ('AMINISTRADOR', 'CHIPS_INGRESAR'),
    ('AMINISTRADOR', 'CHIPS_TRANSFERIR'),
    ('AMINISTRADOR', 'CHIPS_VENDER'),
    ('AMINISTRADOR', 'CHIPS_VER'),
    ('AMINISTRADOR', 'CONFIGURACION_CATEGORIAS'),
    ('AMINISTRADOR', 'CONFIGURACION_EMPRESAS'),
    ('AMINISTRADOR', 'CONFIGURACION_PRODUCTOS'),
    ('AMINISTRADOR', 'CONFIGURACION_SEDES'),
    ('AMINISTRADOR', 'CONFIGURACION_SERIES'),
    ('AMINISTRADOR', 'CONFIGURACION_SERVICIOS'),
    ('AMINISTRADOR', 'CONFIGURACION_TARIFAS'),
    ('AMINISTRADOR', 'DASHBOARD_EXPORTAR'),
    ('AMINISTRADOR', 'DASHBOARD_GLOBAL'),
    ('AMINISTRADOR', 'DASHBOARD_SEDE'),
    ('AMINISTRADOR', 'DESCUENTOS_ADMINISTRAR'),
    ('AMINISTRADOR', 'FAREGAS_ANULAR_COMPROBANTE'),
    ('AMINISTRADOR', 'FAREGAS_CERTIFICADO_ANULAR_EJECUTAR'),
    ('AMINISTRADOR', 'FAREGAS_CERTIFICADO_RECTIFICAR_EJECUTAR'),
    ('AMINISTRADOR', 'FAREGAS_NOTA_CREDITO'),
    ('AMINISTRADOR', 'FAREGAS_NOTA_CREDITO_APROBAR'),
    ('AMINISTRADOR', 'FAREGAS_NOTA_CREDITO_AUTOAPROBAR'),
    ('AMINISTRADOR', 'FAREGAS_NOTIFICACION_CORTESIA_RECIBIR'),
    ('AMINISTRADOR', 'FAREGAS_SOLICITUD_ADMINISTRAR'),
    ('AMINISTRADOR', 'FAREGAS_SOLICITUD_APROBAR'),
    ('AMINISTRADOR', 'FAREGAS_SOLICITUD_AUTOAPROBAR'),
    ('AMINISTRADOR', 'FAREGAS_SOLICITUD_AUTOEJECUTAR'),
    ('AMINISTRADOR', 'FAREGAS_SOLICITUD_CREAR'),
    ('AMINISTRADOR', 'FAREGAS_SOLICITUD_RECHAZAR'),
    ('AMINISTRADOR', 'FAREGAS_SOLICITUD_VER'),
    ('AMINISTRADOR', 'MENU_AUDITORIA'),
    ('AMINISTRADOR', 'MENU_CHIPS'),
    ('AMINISTRADOR', 'MENU_CHIPS_INVENTARIO'),
    ('AMINISTRADOR', 'MENU_CHIPS_TIPOS'),
    ('AMINISTRADOR', 'MENU_CHIPS_VENTAS'),
    ('AMINISTRADOR', 'MENU_CONFIGURACION'),
    ('AMINISTRADOR', 'MENU_CONFIGURACION_CATALOGO'),
    ('AMINISTRADOR', 'MENU_CONFIGURACION_CORRELATIVOS'),
    ('AMINISTRADOR', 'MENU_CONFIGURACION_EMPRESAS'),
    ('AMINISTRADOR', 'MENU_CONFIGURACION_SEDES'),
    ('AMINISTRADOR', 'MENU_CONFIGURACION_TARIFAS'),
    ('AMINISTRADOR', 'MENU_DASHBOARD'),
    ('AMINISTRADOR', 'MENU_DESCUENTOS'),
    ('AMINISTRADOR', 'MENU_FACTURACION'),
    ('AMINISTRADOR', 'MENU_FACTURACION_CLIENTES'),
    ('AMINISTRADOR', 'MENU_FACTURACION_COMPROBANTES'),
    ('AMINISTRADOR', 'MENU_FACTURACION_PREPARACION'),
    ('AMINISTRADOR', 'MENU_FACTURACION_SERIES'),
    ('AMINISTRADOR', 'MENU_INICIO'),
    ('AMINISTRADOR', 'MENU_USUARIOS'),
    ('ADMINISTRADOR', 'CHIPS_BAJA'),
    ('ADMINISTRADOR', 'CHIPS_CONFIGURAR'),
    ('ADMINISTRADOR', 'CHIPS_INGRESAR'),
    ('ADMINISTRADOR', 'CHIPS_TRANSFERIR'),
    ('ADMINISTRADOR', 'CHIPS_VENDER'),
    ('ADMINISTRADOR', 'CHIPS_VER'),
    ('ADMINISTRADOR', 'CONFIGURACION_CATEGORIAS'),
    ('ADMINISTRADOR', 'CONFIGURACION_EMPRESAS'),
    ('ADMINISTRADOR', 'CONFIGURACION_PRODUCTOS'),
    ('ADMINISTRADOR', 'CONFIGURACION_SEDES'),
    ('ADMINISTRADOR', 'CONFIGURACION_SERIES'),
    ('ADMINISTRADOR', 'CONFIGURACION_SERVICIOS'),
    ('ADMINISTRADOR', 'CONFIGURACION_TARIFAS'),
    ('ADMINISTRADOR', 'DASHBOARD_EXPORTAR'),
    ('ADMINISTRADOR', 'DASHBOARD_GLOBAL'),
    ('ADMINISTRADOR', 'DASHBOARD_SEDE'),
    ('ADMINISTRADOR', 'DESCUENTOS_ADMINISTRAR'),
    ('ADMINISTRADOR', 'FAREGAS_ANULAR_COMPROBANTE'),
    ('ADMINISTRADOR', 'FAREGAS_CERTIFICADO_ANULAR_EJECUTAR'),
    ('ADMINISTRADOR', 'FAREGAS_CERTIFICADO_RECTIFICAR_EJECUTAR'),
    ('ADMINISTRADOR', 'FAREGAS_NOTA_CREDITO'),
    ('ADMINISTRADOR', 'FAREGAS_NOTA_CREDITO_APROBAR'),
    ('ADMINISTRADOR', 'FAREGAS_NOTA_CREDITO_AUTOAPROBAR'),
    ('ADMINISTRADOR', 'FAREGAS_NOTIFICACION_CORTESIA_RECIBIR'),
    ('ADMINISTRADOR', 'FAREGAS_SOLICITUD_ADMINISTRAR'),
    ('ADMINISTRADOR', 'FAREGAS_SOLICITUD_APROBAR'),
    ('ADMINISTRADOR', 'FAREGAS_SOLICITUD_AUTOAPROBAR'),
    ('ADMINISTRADOR', 'FAREGAS_SOLICITUD_AUTOEJECUTAR'),
    ('ADMINISTRADOR', 'FAREGAS_SOLICITUD_CREAR'),
    ('ADMINISTRADOR', 'FAREGAS_SOLICITUD_RECHAZAR'),
    ('ADMINISTRADOR', 'FAREGAS_SOLICITUD_VER'),
    ('ADMINISTRADOR', 'MENU_AUDITORIA'),
    ('ADMINISTRADOR', 'MENU_CHIPS'),
    ('ADMINISTRADOR', 'MENU_CHIPS_INVENTARIO'),
    ('ADMINISTRADOR', 'MENU_CHIPS_TIPOS'),
    ('ADMINISTRADOR', 'MENU_CHIPS_VENTAS'),
    ('ADMINISTRADOR', 'MENU_CONFIGURACION'),
    ('ADMINISTRADOR', 'MENU_CONFIGURACION_CATALOGO'),
    ('ADMINISTRADOR', 'MENU_CONFIGURACION_CORRELATIVOS'),
    ('ADMINISTRADOR', 'MENU_CONFIGURACION_EMPRESAS'),
    ('ADMINISTRADOR', 'MENU_CONFIGURACION_SEDES'),
    ('ADMINISTRADOR', 'MENU_CONFIGURACION_TARIFAS'),
    ('ADMINISTRADOR', 'MENU_DASHBOARD'),
    ('ADMINISTRADOR', 'MENU_DESCUENTOS'),
    ('ADMINISTRADOR', 'MENU_FACTURACION'),
    ('ADMINISTRADOR', 'MENU_FACTURACION_CLIENTES'),
    ('ADMINISTRADOR', 'MENU_FACTURACION_COMPROBANTES'),
    ('ADMINISTRADOR', 'MENU_FACTURACION_PREPARACION'),
    ('ADMINISTRADOR', 'MENU_FACTURACION_SERIES'),
    ('ADMINISTRADOR', 'MENU_INICIO'),
    ('ADMINISTRADOR', 'MENU_USUARIOS'),
    ('CONTADOR', 'DASHBOARD_EXPORTAR'),
    ('CONTADOR', 'DASHBOARD_GLOBAL'),
    ('CONTADOR', 'MENU_DASHBOARD'),
    ('CONTADOR', 'MENU_FACTURACION'),
    ('CONTADOR', 'MENU_FACTURACION_COMPROBANTES'),
    ('CONTADOR', 'MENU_INICIO'),
    ('JEFE_PLANTA', 'CHIPS_TRANSFERIR'),
    ('JEFE_PLANTA', 'CHIPS_VER'),
    ('JEFE_PLANTA', 'DASHBOARD_SEDE'),
    ('JEFE_PLANTA', 'FAREGAS_ANULAR_COMPROBANTE'),
    ('JEFE_PLANTA', 'FAREGAS_SOLICITUD_CREAR'),
    ('JEFE_PLANTA', 'FAREGAS_SOLICITUD_VER'),
    ('JEFE_PLANTA', 'MENU_CHIPS'),
    ('JEFE_PLANTA', 'MENU_CHIPS_INVENTARIO'),
    ('JEFE_PLANTA', 'MENU_DASHBOARD'),
    ('JEFE_PLANTA', 'MENU_FACTURACION'),
    ('JEFE_PLANTA', 'MENU_FACTURACION_COMPROBANTES'),
    ('JEFE_PLANTA', 'MENU_INICIO'),
    ('OPERADOR', 'CHIPS_VENDER'),
    ('OPERADOR', 'CHIPS_VER'),
    ('OPERADOR', 'DASHBOARD_EXPORTAR'),
    ('OPERADOR', 'DASHBOARD_GLOBAL'),
    ('OPERADOR', 'FAREGAS_SOLICITUD_CREAR'),
    ('OPERADOR', 'FAREGAS_SOLICITUD_VER'),
    ('OPERADOR', 'MENU_CHIPS'),
    ('OPERADOR', 'MENU_CHIPS_INVENTARIO'),
    ('OPERADOR', 'MENU_CHIPS_VENTAS'),
    ('OPERADOR', 'MENU_FACTURACION'),
    ('OPERADOR', 'MENU_FACTURACION_CLIENTES'),
    ('OPERADOR', 'MENU_FACTURACION_COMPROBANTES'),
    ('OPERADOR', 'MENU_FACTURACION_PREPARACION'),
    ('OPERADOR', 'MENU_DASHBOARD'),
    ('OPERADOR', 'MENU_INICIO'),
    ('CAJERO', 'CHIPS_VENDER'),
    ('CAJERO', 'CHIPS_VER'),
    ('CAJERO', 'MENU_CHIPS'),
    ('CAJERO', 'MENU_CHIPS_VENTAS'),
    ('CAJERO', 'MENU_FACTURACION'),
    ('CAJERO', 'MENU_FACTURACION_CLIENTES'),
    ('CAJERO', 'MENU_FACTURACION_COMPROBANTES'),
    ('CAJERO', 'MENU_FACTURACION_PREPARACION'),
    ('CAJERO', 'MENU_INICIO'),
    ('CERTIFICADOR', 'FAREGAS_SOLICITUD_CREAR'),
    ('CERTIFICADOR', 'FAREGAS_SOLICITUD_VER'),
    ('CERTIFICADOR', 'MENU_INICIO'),
    ('CONSULTA', 'CHIPS_VER'),
    ('CONSULTA', 'DASHBOARD_SEDE'),
    ('CONSULTA', 'FAREGAS_SOLICITUD_VER'),
    ('CONSULTA', 'MENU_DASHBOARD'),
    ('CONSULTA', 'MENU_FACTURACION_COMPROBANTES'),
    ('CONSULTA', 'MENU_INICIO'),
    ('SUPERVISOR', 'CHIPS_VER'),
    ('SUPERVISOR', 'DASHBOARD_EXPORTAR'),
    ('SUPERVISOR', 'DASHBOARD_GLOBAL'),
    ('SUPERVISOR', 'FAREGAS_ANULAR_COMPROBANTE'),
    ('SUPERVISOR', 'FAREGAS_NOTA_CREDITO'),
    ('SUPERVISOR', 'FAREGAS_NOTA_CREDITO_APROBAR'),
    ('SUPERVISOR', 'FAREGAS_NOTIFICACION_CORTESIA_RECIBIR'),
    ('SUPERVISOR', 'FAREGAS_SOLICITUD_ADMINISTRAR'),
    ('SUPERVISOR', 'FAREGAS_SOLICITUD_APROBAR'),
    ('SUPERVISOR', 'FAREGAS_SOLICITUD_RECHAZAR'),
    ('SUPERVISOR', 'FAREGAS_SOLICITUD_VER'),
    ('SUPERVISOR', 'MENU_AUDITORIA'),
    ('SUPERVISOR', 'MENU_CHIPS'),
    ('SUPERVISOR', 'MENU_CHIPS_INVENTARIO'),
    ('SUPERVISOR', 'MENU_DASHBOARD'),
    ('SUPERVISOR', 'MENU_DESCUENTOS'),
    ('SUPERVISOR', 'MENU_FACTURACION'),
    ('SUPERVISOR', 'MENU_FACTURACION_COMPROBANTES'),
    ('SUPERVISOR', 'MENU_INICIO'),
    ('TALLER', 'MENU_INICIO'),
    ('SISTEMAS', 'CHIPS_BAJA'),
    ('SISTEMAS', 'CHIPS_CONFIGURAR'),
    ('SISTEMAS', 'CHIPS_INGRESAR'),
    ('SISTEMAS', 'CHIPS_TRANSFERIR'),
    ('SISTEMAS', 'CHIPS_VENDER'),
    ('SISTEMAS', 'CHIPS_VER'),
    ('SISTEMAS', 'CONFIGURACION_CATEGORIAS'),
    ('SISTEMAS', 'CONFIGURACION_EMPRESAS'),
    ('SISTEMAS', 'CONFIGURACION_PRODUCTOS'),
    ('SISTEMAS', 'CONFIGURACION_SEDES'),
    ('SISTEMAS', 'CONFIGURACION_SERIES'),
    ('SISTEMAS', 'CONFIGURACION_SERVICIOS'),
    ('SISTEMAS', 'CONFIGURACION_TARIFAS'),
    ('SISTEMAS', 'DASHBOARD_EXPORTAR'),
    ('SISTEMAS', 'DASHBOARD_GLOBAL'),
    ('SISTEMAS', 'DASHBOARD_SEDE'),
    ('SISTEMAS', 'DESCUENTOS_ADMINISTRAR'),
    ('SISTEMAS', 'FAREGAS_ANULAR_COMPROBANTE'),
    ('SISTEMAS', 'FAREGAS_CERTIFICADO_ANULAR_EJECUTAR'),
    ('SISTEMAS', 'FAREGAS_CERTIFICADO_RECTIFICAR_EJECUTAR'),
    ('SISTEMAS', 'FAREGAS_NOTA_CREDITO'),
    ('SISTEMAS', 'FAREGAS_NOTA_CREDITO_APROBAR'),
    ('SISTEMAS', 'FAREGAS_NOTA_CREDITO_AUTOAPROBAR'),
    ('SISTEMAS', 'FAREGAS_NOTIFICACION_CORTESIA_RECIBIR'),
    ('SISTEMAS', 'FAREGAS_SOLICITUD_ADMINISTRAR'),
    ('SISTEMAS', 'FAREGAS_SOLICITUD_APROBAR'),
    ('SISTEMAS', 'FAREGAS_SOLICITUD_AUTOAPROBAR'),
    ('SISTEMAS', 'FAREGAS_SOLICITUD_AUTOEJECUTAR'),
    ('SISTEMAS', 'FAREGAS_SOLICITUD_CREAR'),
    ('SISTEMAS', 'FAREGAS_SOLICITUD_RECHAZAR'),
    ('SISTEMAS', 'FAREGAS_SOLICITUD_VER'),
    ('SISTEMAS', 'MENU_AUDITORIA'),
    ('SISTEMAS', 'MENU_CHIPS'),
    ('SISTEMAS', 'MENU_CHIPS_INVENTARIO'),
    ('SISTEMAS', 'MENU_CHIPS_TIPOS'),
    ('SISTEMAS', 'MENU_CHIPS_VENTAS'),
    ('SISTEMAS', 'MENU_CONFIGURACION'),
    ('SISTEMAS', 'MENU_CONFIGURACION_CATALOGO'),
    ('SISTEMAS', 'MENU_CONFIGURACION_CORRELATIVOS'),
    ('SISTEMAS', 'MENU_CONFIGURACION_EMPRESAS'),
    ('SISTEMAS', 'MENU_CONFIGURACION_SEDES'),
    ('SISTEMAS', 'MENU_CONFIGURACION_TARIFAS'),
    ('SISTEMAS', 'MENU_DASHBOARD'),
    ('SISTEMAS', 'MENU_DESCUENTOS'),
    ('SISTEMAS', 'MENU_FACTURACION'),
    ('SISTEMAS', 'MENU_FACTURACION_CLIENTES'),
    ('SISTEMAS', 'MENU_FACTURACION_COMPROBANTES'),
    ('SISTEMAS', 'MENU_FACTURACION_PREPARACION'),
    ('SISTEMAS', 'MENU_FACTURACION_SERIES'),
    ('SISTEMAS', 'MENU_INICIO'),
    ('SISTEMAS', 'MENU_USUARIOS')
ON CONFLICT (perfil_clave, permiso_clave) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 4. CATÁLOGO DE TIPOS DE CERTIFICADO (fg_tipo_certificado)
-- ----------------------------------------------------------------------------
-- Códigos del tipo verificados en el catálogo, sin series ni números asignados.
-- Resolución, domicilio, lugar, teléfono y entidad certificadora se provisionan
-- por ambiente desde la configuración y los formatos vigentes.
INSERT INTO public.fg_tipo_certificado (clave, nombre, codigo, ancho_correlativo)
VALUES
    ('CONFORMIDAD', 'Certificado de Conformidad', '39', 6),
    ('GLP_ANUAL', 'Certificado de Inspección GLP', '41', 6),
    ('GNV_ANUAL', 'Certificado de Inspección Anual GNV', '22', 7),
    ('TALLER_GLP', 'Taller GLP', 'T1', NULL),
    ('TALLER_GNV', 'Taller GNV', 'T2', NULL)
ON CONFLICT (clave) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 5. USUARIO TÉCNICO DE SISTEMA (fg_usuario)
-- Cuenta deshabilitada (estado=false) exclusivamente para atribución de auditoría
-- de catálogos y semillas iniciales. No contiene credenciales de personas reales.
-- ----------------------------------------------------------------------------
INSERT INTO public.fg_usuario (username, user_type, contrasenha, perfil_id, estado)
VALUES ('SISTEMAS_FAREGAS', 'SISTEMA', 'CUENTA_TECNICA_INICIAL_BLOQUEADA', 'SISTEMAS', FALSE)
ON CONFLICT (username) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 6. REGLAS BASE DE DESCUENTO COMERCIAL (fg_descuento)
-- ----------------------------------------------------------------------------
INSERT INTO public.fg_descuento (
    codigo, nombre, tipo, tipo_calculo, valor,
    fecha_inicio, fecha_fin, activo, usuario_creacion
)
SELECT
    'CORTESIA_FAREGAS',
    'CORTESÍA FAREGAS',
    'PROMOCION',
    'PORCENTAJE',
    100,
    TIMESTAMP '2020-01-01 00:00:00',
    TIMESTAMP '2099-12-31 23:59:59',
    TRUE,
    'SISTEMAS_FAREGAS'
WHERE NOT EXISTS (
    SELECT 1
    FROM public.fg_descuento
    WHERE UPPER(BTRIM(codigo)) = 'CORTESIA_FAREGAS'
);

-- =============================================================================
-- SECCIÓN 7: MIGRACIONES DE DATOS
-- =============================================================================
UPDATE public.fg_descuento
SET nombre = 'CORTESÍA FAREGAS',
    tipo = 'PROMOCION',
    tipo_calculo = 'PORCENTAJE',
    valor = 100,
    activo = TRUE,
    fecha_modificacion = CURRENT_TIMESTAMP,
    usuario_modificacion = 'SISTEMAS_FAREGAS'
WHERE UPPER(BTRIM(codigo)) = 'CORTESIA_FAREGAS';

-- =============================================================================
-- SECCIÓN 3: MODIFICACIONES DE COLUMNAS
-- =============================================================================
-- ==== migrations/002_ampliacion_auditoria_integral.sql ====
-- Migración 002: Ampliación de Auditoría Integral FAREGAS
-- Fecha: 2026-11-13
-- Idempotente y compatible con PostgreSQL 13+


-- 1. Ampliar longitud de columnas existentes
ALTER TABLE public.fg_auditoria_acceso ALTER COLUMN categoria TYPE character varying(50);
ALTER TABLE public.fg_auditoria_acceso ALTER COLUMN evento TYPE character varying(100);

-- 2. Agregar nuevas columnas de auditoría detallada
ALTER TABLE public.fg_auditoria_acceso ADD COLUMN IF NOT EXISTS usuario_id bigint;
ALTER TABLE public.fg_auditoria_acceso ADD COLUMN IF NOT EXISTS modulo character varying(50);
ALTER TABLE public.fg_auditoria_acceso ADD COLUMN IF NOT EXISTS resultado character varying(20) DEFAULT 'EXITO' NOT NULL;
ALTER TABLE public.fg_auditoria_acceso ADD COLUMN IF NOT EXISTS motivo_error text;
ALTER TABLE public.fg_auditoria_acceso ADD COLUMN IF NOT EXISTS documento_referencia character varying(100);
ALTER TABLE public.fg_auditoria_acceso ADD COLUMN IF NOT EXISTS es_automatico boolean DEFAULT false NOT NULL;
ALTER TABLE public.fg_auditoria_acceso ADD COLUMN IF NOT EXISTS correlacion_id character varying(100);
ALTER TABLE public.fg_auditoria_acceso ADD COLUMN IF NOT EXISTS datos_previos jsonb;
ALTER TABLE public.fg_auditoria_acceso ADD COLUMN IF NOT EXISTS datos_nuevos jsonb;

-- 3. Índices para optimizar consultas por módulo, documento y resultado
CREATE INDEX IF NOT EXISTS idx_fg_auditoria_modulo_fecha ON public.fg_auditoria_acceso USING btree (modulo, fecha_evento DESC);
CREATE INDEX IF NOT EXISTS idx_fg_auditoria_resultado ON public.fg_auditoria_acceso USING btree (resultado);
CREATE INDEX IF NOT EXISTS idx_fg_auditoria_doc_ref ON public.fg_auditoria_acceso USING btree (documento_referencia);

-- 4. Comentarios descriptivos
COMMENT ON COLUMN public.fg_auditoria_acceso.usuario_id IS 'ID del usuario en fg_usuario que ejecutó la acción';
COMMENT ON COLUMN public.fg_auditoria_acceso.modulo IS 'Módulo funcional de FAREGAS (CERTIFICADOS, FACTURACION, PAGOS, etc.)';
COMMENT ON COLUMN public.fg_auditoria_acceso.resultado IS 'Resultado del evento: EXITO, ERROR, RECHAZADO, ADVERTENCIA';
COMMENT ON COLUMN public.fg_auditoria_acceso.motivo_error IS 'Descripción técnica o mensaje de error en caso de fallo';
COMMENT ON COLUMN public.fg_auditoria_acceso.documento_referencia IS 'Identificador visible del documento: serie-correlativo, placa, o clave';
COMMENT ON COLUMN public.fg_auditoria_acceso.es_automatico IS 'Indica si la acción fue generada por worker/cron job o por usuario humano';
COMMENT ON COLUMN public.fg_auditoria_acceso.correlacion_id IS 'Identificador de correlación o sesión para trazabilidad distribuida';
COMMENT ON COLUMN public.fg_auditoria_acceso.datos_previos IS 'Snapshot de los valores auditables antes de la modificación';
COMMENT ON COLUMN public.fg_auditoria_acceso.datos_nuevos IS 'Snapshot de los valores auditables después de la modificación';

-- =============================================================================
-- SECCIÓN 10: USUARIOS, PERFILES Y PERMISOS
-- =============================================================================
-- ==== migrations/003_migracion_fg_usuario_perfil_independiente.sql ====
-- ============================================================================
-- MIGRACIÓN INCREMENTAL: 003_migracion_fg_usuario_perfil_independiente.sql
-- Sistema: FAREGAS
-- Objetivo: Crear la tabla fg_usuario_perfil para la administración independiente
--           de perfiles y datos personales de usuarios FAREGAS, desvinculando
--           por completo las escrituras de la tabla 'persona' de FARENET.
-- Idempotencia: 100% seguro para re-ejecución sin duplicados ni pérdida de datos.
-- ============================================================================


-- 1. Crear tabla fg_usuario_perfil si no existe
CREATE TABLE IF NOT EXISTS public.fg_usuario_perfil (
    usuario_username character varying(255) NOT NULL,
    tipo_documento_key character varying(20) NOT NULL,
    nro_documento character varying(20) NOT NULL,
    nombres character varying(200),
    apellidos character varying(200),
    nombre_razon_social character varying(500),
    pais_key character varying(20),
    departamento_key character varying(20),
    provincia_key character varying(20),
    distrito_key character varying(20),
    direccion character varying(500),
    email character varying(150),
    telefono character varying(100),
    persona_contacto character varying(255),
    fecha_creacion timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    fecha_actualizacion timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- 2. Clave primaria
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fg_usuario_perfil_pkey'
    ) THEN
        ALTER TABLE ONLY public.fg_usuario_perfil
            ADD CONSTRAINT fg_usuario_perfil_pkey PRIMARY KEY (usuario_username);
    END IF;
END $$;

-- 3. Restricción de unicidad de documento
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'uq_fg_usuario_perfil_documento'
    ) THEN
        ALTER TABLE ONLY public.fg_usuario_perfil
            ADD CONSTRAINT uq_fg_usuario_perfil_documento UNIQUE (tipo_documento_key, nro_documento);
    END IF;
END $$;

-- 4. Índice para búsquedas por nombre/apellidos
CREATE INDEX IF NOT EXISTS idx_fg_usuario_perfil_nombre 
    ON public.fg_usuario_perfil USING btree (nombre_razon_social, apellidos, nombres);

-- 5. Clave foránea hacia fg_usuario
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_fg_usuario_perfil_usuario'
    ) THEN
        ALTER TABLE ONLY public.fg_usuario_perfil
            ADD CONSTRAINT fk_fg_usuario_perfil_usuario 
            FOREIGN KEY (usuario_username) REFERENCES public.fg_usuario(username) 
            ON UPDATE CASCADE ON DELETE CASCADE;
    END IF;
END $$;

-- 6. Backfill inicial seguro desde 'persona' para usuarios existentes en fg_usuario
--    (Permite que los usuarios ya existentes tengan su perfil propio sin tocar FARENET)
DO $$
DECLARE
    tiene_tipo_doc boolean;
    tiene_dir boolean;
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'persona') THEN
        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'persona' AND column_name = 'tipodocumentoidentidad_key'
        ) INTO tiene_tipo_doc;

        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'persona' AND column_name = 'direccion'
        ) INTO tiene_dir;

        IF tiene_tipo_doc AND tiene_dir THEN
            -- Entorno con esquema completo de persona (Base compartida / Producción)
            INSERT INTO public.fg_usuario_perfil (
                usuario_username, tipo_documento_key, nro_documento,
                nombres, apellidos, nombre_razon_social,
                pais_key, departamento_key, provincia_key, distrito_key,
                direccion, email, telefono, persona_contacto,
                fecha_creacion, fecha_actualizacion
            )
            SELECT 
                u.username,
                COALESCE(p.tipodocumentoidentidad_key, 'DNI'),
                COALESCE(p.nrodocumentoidentidad, u.persona_nrodocumentoidentidad, '00000000'),
                p.nombres,
                p.apellidos,
                p.nombrerazonsocial,
                p.pais_key,
                p.departamento_key,
                p.provincia_key,
                p.distrito_key,
                p.direccion,
                p.email,
                p.telefono,
                p.persona_contacto,
                CURRENT_TIMESTAMP,
                CURRENT_TIMESTAMP
            FROM public.fg_usuario u
            JOIN public.persona p ON u.persona_nrodocumentoidentidad = p.nrodocumentoidentidad
            ON CONFLICT (usuario_username) DO NOTHING;
        ELSE
            -- Entorno aislado / stub minimalista
            INSERT INTO public.fg_usuario_perfil (
                usuario_username, tipo_documento_key, nro_documento,
                nombres, apellidos,
                fecha_creacion, fecha_actualizacion
            )
            SELECT 
                u.username,
                'DNI',
                COALESCE(u.persona_nrodocumentoidentidad, '00000000'),
                p.nombres,
                p.apellidos,
                CURRENT_TIMESTAMP,
                CURRENT_TIMESTAMP
            FROM public.fg_usuario u
            JOIN public.persona p ON u.persona_nrodocumentoidentidad = p.nrodocumentoidentidad
            ON CONFLICT (usuario_username) DO NOTHING;
        END IF;
    END IF;
END $$;

-- ==== migrations/004_implementacion_detracciones_spot.sql ====
-- ============================================================================
-- MIGRACIÓN INCREMENTAL: 004_implementacion_detracciones_spot.sql
-- Sistema: FAREGAS
-- Objetivo: Añadir soporte para el Sistema de Pago de Obligaciones Tributarias
--           (SPOT / Detracciones SUNAT) en comprobantes, notas de crédito y catálogos.
-- Idempotencia: 100% seguro para re-ejecución sin duplicados ni pérdida de datos.
-- ============================================================================


-- 1. Campos en fg_facturacion para Detracciones SPOT
ALTER TABLE public.fg_facturacion
    ADD COLUMN IF NOT EXISTS sujeto_detraccion boolean,
    ADD COLUMN IF NOT EXISTS detraccion_codigo varchar(10),
    ADD COLUMN IF NOT EXISTS detraccion_descripcion varchar(255),
    ADD COLUMN IF NOT EXISTS detraccion_porcentaje numeric(5,2),
    ADD COLUMN IF NOT EXISTS detraccion_base numeric(12,2),
    ADD COLUMN IF NOT EXISTS detraccion_monto numeric(12,2),
    ADD COLUMN IF NOT EXISTS detraccion_neto numeric(12,2),
    ADD COLUMN IF NOT EXISTS detraccion_estado_deposito varchar(30),
    ADD COLUMN IF NOT EXISTS detraccion_constancia_nro varchar(50),
    ADD COLUMN IF NOT EXISTS detraccion_constancia_fecha date,
    ADD COLUMN IF NOT EXISTS detraccion_motivo_exclusion varchar(150);

-- 2. Campos en fg_credito (Notas de Crédito)
ALTER TABLE public.fg_credito
    ADD COLUMN IF NOT EXISTS sujeto_detraccion boolean,
    ADD COLUMN IF NOT EXISTS detraccion_codigo varchar(10),
    ADD COLUMN IF NOT EXISTS detraccion_descripcion varchar(255),
    ADD COLUMN IF NOT EXISTS detraccion_porcentaje numeric(5,2),
    ADD COLUMN IF NOT EXISTS detraccion_base numeric(12,2),
    ADD COLUMN IF NOT EXISTS detraccion_monto numeric(12,2),
    ADD COLUMN IF NOT EXISTS detraccion_neto numeric(12,2),
    ADD COLUMN IF NOT EXISTS detraccion_estado_deposito varchar(30),
    ADD COLUMN IF NOT EXISTS detraccion_constancia_nro varchar(50),
    ADD COLUMN IF NOT EXISTS detraccion_constancia_fecha date,
    ADD COLUMN IF NOT EXISTS detraccion_motivo_exclusion varchar(150);

-- 3. Campos de configuración SPOT en fg_servicio
ALTER TABLE public.fg_servicio
    ADD COLUMN IF NOT EXISTS sujeto_detraccion boolean,
    ADD COLUMN IF NOT EXISTS detraccion_codigo varchar(10),
    ADD COLUMN IF NOT EXISTS detraccion_porcentaje numeric(5,2);

-- 4. Campos de configuración SPOT en fg_producto_facturacion
ALTER TABLE public.fg_producto_facturacion
    ADD COLUMN IF NOT EXISTS sujeto_detraccion boolean,
    ADD COLUMN IF NOT EXISTS detraccion_codigo varchar(10),
    ADD COLUMN IF NOT EXISTS detraccion_porcentaje numeric(5,2),
    ADD COLUMN IF NOT EXISTS naturaleza_spot varchar(20);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'chk_fg_producto_facturacion_naturaleza_spot'
    ) THEN
        ALTER TABLE public.fg_producto_facturacion
            ADD CONSTRAINT chk_fg_producto_facturacion_naturaleza_spot
            CHECK (naturaleza_spot IS NULL OR naturaleza_spot IN ('BIEN', 'SERVICIO'));
    END IF;
END $$;

-- 5. Índices para optimizar reportes y búsquedas de comprobantes con detracción
CREATE INDEX IF NOT EXISTS idx_fg_facturacion_detraccion 
    ON public.fg_facturacion (sujeto_detraccion, detraccion_estado_deposito)
    WHERE sujeto_detraccion = true;

CREATE INDEX IF NOT EXISTS idx_fg_facturacion_detraccion_constancia
    ON public.fg_facturacion (detraccion_constancia_nro)
    WHERE detraccion_constancia_nro IS NOT NULL;

-- 6. No se presume una clasificación SPOT para servicios o productos.
-- NULL significa "pendiente de clasificación tributaria"; configurar cada
-- servicio contra el Anexo aplicable antes de emitir una factura > S/ 700.

-- ==== migrations/006_codigos_chip_autogenerables.sql ====
-- FAREGAS — Códigos disponibles de chips con opt-in por tipo de producto.
-- Incremental, transaccional e independiente de tablas FARENET.
-- No clasifica ni modifica productos/chips existentes. Todos los productos
-- existentes reciben FALSE por el DEFAULT y requieren habilitación explícita.


ALTER TABLE public.fg_producto_inventariable
    ADD COLUMN IF NOT EXISTS codigo_autogenerable boolean NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS public.fg_chip_codigo_reserva (
    id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    token uuid NOT NULL,
    numero_chip character varying(120) NOT NULL,
    producto_inventariable_id bigint NOT NULL,
    planta_key character varying NOT NULL,
    creado_por character varying NOT NULL,
    creado_en timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    vence_en timestamp with time zone NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_fg_chip_codigo_reserva_numero
    ON public.fg_chip_codigo_reserva (numero_chip);

CREATE INDEX IF NOT EXISTS idx_fg_chip_codigo_reserva_token
    ON public.fg_chip_codigo_reserva (token);

CREATE INDEX IF NOT EXISTS idx_fg_chip_codigo_reserva_vencimiento
    ON public.fg_chip_codigo_reserva (vence_en);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.fg_chip_codigo_reserva'::regclass
          AND conname = 'fk_fg_chip_codigo_reserva_producto'
    ) THEN
        ALTER TABLE public.fg_chip_codigo_reserva
            ADD CONSTRAINT fk_fg_chip_codigo_reserva_producto
            FOREIGN KEY (producto_inventariable_id)
            REFERENCES public.fg_producto_inventariable(id)
            ON DELETE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.fg_chip_codigo_reserva'::regclass
          AND conname = 'fk_fg_chip_codigo_reserva_planta'
    ) THEN
        ALTER TABLE public.fg_chip_codigo_reserva
            ADD CONSTRAINT fk_fg_chip_codigo_reserva_planta
            FOREIGN KEY (planta_key)
            REFERENCES public.fg_planta(key)
            ON DELETE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.fg_chip_codigo_reserva'::regclass
          AND conname = 'ck_fg_chip_codigo_reserva_no_vacio'
    ) THEN
        ALTER TABLE public.fg_chip_codigo_reserva
            ADD CONSTRAINT ck_fg_chip_codigo_reserva_no_vacio
            CHECK (btrim(numero_chip) <> '');
    END IF;
END $$;

-- ==== migrations/007_permisos_dashboard_perfiles_operativos.sql ====
-- Permisos de consulta y exportación del Dashboard para perfiles operativos.
-- No altera usuarios ni asignaciones de sedes. El backend mantiene el filtro
-- por las sedes autorizadas a cada usuario.

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM (VALUES
            ('CONTADOR', 'DASHBOARD_GLOBAL'),
            ('CONTADOR', 'DASHBOARD_EXPORTAR'),
            ('OPERADOR', 'MENU_DASHBOARD'),
            ('OPERADOR', 'DASHBOARD_GLOBAL'),
            ('OPERADOR', 'DASHBOARD_EXPORTAR')
        ) AS requeridos(perfil_clave, permiso_clave)
        LEFT JOIN public.fg_perfil perfil ON perfil.clave = requeridos.perfil_clave
        LEFT JOIN public.fg_permiso permiso
            ON permiso.clave = requeridos.permiso_clave
           AND permiso.activo = TRUE
        WHERE perfil.clave IS NULL
           OR perfil.visible IS DISTINCT FROM TRUE
           OR permiso.clave IS NULL
    ) THEN
        RAISE EXCEPTION 'No se pueden asignar permisos Dashboard: perfil no visible o permiso inexistente/inactivo.';
    END IF;
END $$;

INSERT INTO public.fg_perfil_permiso (perfil_clave, permiso_clave)
VALUES
    ('CONTADOR', 'DASHBOARD_GLOBAL'),
    ('CONTADOR', 'DASHBOARD_EXPORTAR'),
    ('OPERADOR', 'MENU_DASHBOARD'),
    ('OPERADOR', 'DASHBOARD_GLOBAL'),
    ('OPERADOR', 'DASHBOARD_EXPORTAR')
ON CONFLICT (perfil_clave, permiso_clave) DO NOTHING;

-- ==== migrations/008_habilitar_naturaleza_fiscal_spot.sql ====
-- ============================================================================
-- MIGRACIÓN INCREMENTAL: 008_habilitar_naturaleza_fiscal_spot.sql
-- Sistema: FAREGAS
-- Objetivo: Añadir la columna 'naturaleza_spot' a la tabla 'fg_producto_facturacion'
--           para permitir clasificar un producto comercial como Bien o Servicio
--           en el régimen de detracciones (SPOT) de SUNAT (ej. Certificados como Servicio código 037).
-- Idempotencia: 100% seguro para re-ejecución sin duplicados ni pérdida de datos.
-- ============================================================================


-- 1. Añadir columna naturaleza_spot (BIEN / SERVICIO) a fg_producto_facturacion
ALTER TABLE public.fg_producto_facturacion
    ADD COLUMN IF NOT EXISTS naturaleza_spot character varying(20);

-- 2. Restricción de verificación (CHECK) para asegurar integridad de valores permitidos
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'chk_fg_producto_facturacion_naturaleza_spot'
    ) THEN
        ALTER TABLE public.fg_producto_facturacion
            ADD CONSTRAINT chk_fg_producto_facturacion_naturaleza_spot
            CHECK (naturaleza_spot IS NULL OR naturaleza_spot IN ('BIEN', 'SERVICIO'));
    END IF;
END $$;

-- 3. Comentario explicativo en la columna
COMMENT ON COLUMN public.fg_producto_facturacion.naturaleza_spot IS 
    'Naturaleza fiscal según SUNAT SPOT: BIEN o SERVICIO. Permite que productos comerciales tributen como servicios bajo código 037 (12%).';

-- =============================================================================
-- SECCIÓN 9: CUSTODIA DE CREDENCIALES Y MFA
-- =============================================================================
-- ==== migrations/010_crear_fg_usuario_mfa.sql ====
-- Migración versionada 010: Creación de tabla para segundo factor de autenticación (MFA / TOTP)
-- Esquema no destructivo. Aislado a FAREGAS (sin tocar tablas ni vistas de FARENET).
-- Almacena configuración TOTP (RFC 6238) con secreto cifrado (AES-256-GCM) y códigos de recuperación únicos con hash seguro.
-- Opt-in en desarrollo: no activa obligatoriamente MFA para usuarios existentes sin enrolamiento previo.

CREATE TABLE IF NOT EXISTS public.fg_usuario_mfa (
    username VARCHAR(100) PRIMARY KEY,
    activo BOOLEAN DEFAULT FALSE NOT NULL,
    secreto_cifrado TEXT,
    secreto_iv VARCHAR(64),
    secreto_tag VARCHAR(64),
    codigos_recuperacion JSONB DEFAULT '[]'::jsonb NOT NULL,
    ultimo_paso_usado BIGINT,
    enrolado_en TIMESTAMP WITH TIME ZONE,
    actualizado_en TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT fk_fg_usuario_mfa_user FOREIGN KEY (username) REFERENCES public.fg_usuario(username) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_fg_usuario_mfa_username
ON public.fg_usuario_mfa(LOWER(username));

COMMENT ON TABLE public.fg_usuario_mfa IS 'Almacén de segundo factor TOTP (RFC 6238) y códigos de recuperación únicos para administradores FAREGAS.';

-- ==== migrations/011_crear_fg_facturacion_contingencia.sql ====

CREATE TABLE IF NOT EXISTS public.fg_facturacion_contingencia (
    facturacion_id bigint PRIMARY KEY REFERENCES public.fg_facturacion(id),
    certificado_id bigint NOT NULL UNIQUE REFERENCES public.fg_certificado(id),
    intento_origen_id bigint NOT NULL REFERENCES public.fg_facturacion_intento(id),
    operacion_id bigint REFERENCES public.fg_operacion_comercial(id),
    planta_key varchar(20) NOT NULL REFERENCES public.fg_planta(key),
    empresa_key varchar NOT NULL REFERENCES public.fg_empresa(key),
    usuario_autorizacion varchar(255) NOT NULL,
    fecha_fiscal_original date NOT NULL,
    fecha_autorizacion timestamptz NOT NULL DEFAULT now(),
    diagnostico jsonb NOT NULL,
    estado varchar(20) NOT NULL DEFAULT 'PENDIENTE'
        CHECK (estado IN ('PENDIENTE', 'REVISION', 'REGULARIZADO', 'CANCELADO')),
    intentos integer NOT NULL DEFAULT 0 CHECK (intentos >= 0),
    ultimo_intento timestamptz,
    siguiente_intento timestamptz NOT NULL DEFAULT now(),
    ultimo_resultado varchar(80),
    fecha_regularizacion timestamptz,
    correo_estado varchar(24) NOT NULL DEFAULT 'EN_ESPERA'
        CHECK (correo_estado IN ('EN_ESPERA', 'PENDIENTE', 'ENVIADO', 'SIN_CORREO', 'REVISION')),
    correo_intentos integer NOT NULL DEFAULT 0 CHECK (correo_intentos >= 0),
    correo_proximo timestamptz NOT NULL DEFAULT now(),
    correo_ultimo_error varchar(80),
    correo_referencia varchar(120),
    correo_fecha_envio timestamptz,
    lease_token uuid,
    lease_hasta timestamptz,
    CHECK ((lease_token IS NULL) = (lease_hasta IS NULL))
);

CREATE INDEX IF NOT EXISTS fg_contingencia_fiscal_pendiente_idx
    ON public.fg_facturacion_contingencia (siguiente_intento, facturacion_id)
    WHERE estado = 'PENDIENTE';

CREATE INDEX IF NOT EXISTS fg_contingencia_correo_pendiente_idx
    ON public.fg_facturacion_contingencia (correo_proximo, facturacion_id)
    WHERE estado = 'REGULARIZADO' AND correo_estado = 'PENDIENTE';

-- ==== migrations/012_credenciales_y_custodia.sql ====
-- Estructuras usadas por los servicios de inventario y custodia. Se mantienen
-- vacías y la clave de custodia se provisiona fuera de PostgreSQL.
CREATE TABLE IF NOT EXISTS public.fg_usuario_credencial (
    id serial PRIMARY KEY,
    username varchar(100) NOT NULL UNIQUE,
    estado_credencial varchar(50) NOT NULL,
    tipo_operacion varchar(50) NOT NULL,
    fecha_modificacion timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    responsable varchar(100) NOT NULL,
    cambiada_posteriormente boolean DEFAULT false,
    necesita_restablecimiento boolean DEFAULT false,
    observaciones text,
    CONSTRAINT fk_fg_usuario_credencial_user
        FOREIGN KEY (username) REFERENCES public.fg_usuario(username) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_fg_usuario_credencial_username
    ON public.fg_usuario_credencial (lower(username));

CREATE TABLE IF NOT EXISTS public.fg_credencial_custodia (
    id serial PRIMARY KEY,
    username varchar(100) NOT NULL UNIQUE,
    ciphertext text NOT NULL,
    iv varchar(64) NOT NULL,
    tag varchar(64) NOT NULL,
    algoritmo varchar(30) NOT NULL DEFAULT 'aes-256-gcm',
    version_clave integer NOT NULL DEFAULT 1,
    origen varchar(50) NOT NULL DEFAULT 'ADMINISTRACION_USUARIOS',
    creado_por varchar(100) NOT NULL,
    fecha_creacion timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_actualizacion timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_fg_credencial_custodia_user
        FOREIGN KEY (username) REFERENCES public.fg_usuario(username) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_fg_credencial_custodia_username
    ON public.fg_credencial_custodia (lower(username));

-- =============================================================================
-- SECCIÓN 11: AISLAMIENTO DE FAREGAS FRENTE A FARENET
-- =============================================================================
-- Revocación preventiva de permisos DDL en schema public para garantizar aislamiento.
-- No permite a FAREGAS crear, alterar ni eliminar tablas fuera de fg_*.

-- =============================================================================
-- SECCIÓN 12: ROLES Y PRIVILEGIOS POSTGRESQL
-- =============================================================================
-- ==== migrations/013_rol_minimos_privilegios_faregas.sql ====
-- OBJETIVO: Permitir a FAREGAS operar de forma autónoma con DML completo sobre sus
-- tablas propias (fg_*), garantizando acceso de SOLO LECTURA (SELECT) sobre las tablas
-- operativas y catálogos de FARENET, e IMPIDIENDO cualquier INSERT/UPDATE/DELETE/DDL ajeno.
--
-- NOTA DE SEGURIDAD:
-- - No contiene contraseñas en texto plano ni secretos.
-- - Si el rol ya existe, se conservan sus credenciales vigentes.
-- - Si el rol se crea por primera vez, el DBA / Administrador debe asignarle una
--   contraseña segura mediante: ALTER ROLE faregas_app_user WITH PASSWORD '...';

-- 1. CREACIÓN CONDICIONAL DEL ROL OPERATIVO FAREGAS
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'faregas_app_user') THEN
        CREATE ROLE faregas_app_user WITH
            LOGIN
            NOSUPERUSER
            NOCREATEDB
            NOCREATEROLE
            NOINHERIT
            NOREPLICATION
            CONNECTION LIMIT 50;
        RAISE NOTICE 'Rol faregas_app_user creado sin clave inicial. El DBA debe asignar la clave por canal seguro.';
    ELSE
        RAISE NOTICE 'Rol faregas_app_user ya existe en pg_roles.';
    END IF;
END $$;

-- 2. REVOCACIÓN PREVENTIVA DE PRIVILEGIOS DDL EN EL ESQUEMA PUBLIC PARA EL ROL FAREGAS
-- NOTA DE AISLAMIENTO: No se modifica PUBLIC ni el esquema global para preservar la compatibilidad
-- y los privilegios preexistentes de FARENET u otros microservicios que comparten la base 'inspeccion'.
REVOKE CREATE ON SCHEMA public FROM faregas_app_user;
GRANT USAGE ON SCHEMA public TO faregas_app_user;

-- 3. REVOCACIÓN GENERAL PREVIA SOBRE TODAS LAS TABLAS Y SECUENCIAS DE PUBLIC
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM faregas_app_user;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM faregas_app_user;

-- 4. CONCESIÓN DE DML COMPLETO SOBRE TODAS LAS TABLAS PROPIAS DE FAREGAS (fg_*)
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (
        SELECT tablename 
        FROM pg_tables 
        WHERE schemaname = 'public' AND tablename LIKE 'fg_%'
    ) LOOP
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO faregas_app_user', r.tablename);
    END LOOP;
END $$;

-- Concesión sobre todas las secuencias asociadas a tablas fg_*
DO $$
DECLARE
    s RECORD;
BEGIN
    FOR s IN (
        SELECT sequence_name 
        FROM information_schema.sequences 
        WHERE sequence_schema = 'public' AND sequence_name LIKE 'fg_%'
    ) LOOP
        EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE public.%I TO faregas_app_user', s.sequence_name);
    END LOOP;
END $$;

-- 5. CONCESIÓN CONDICIONAL DE SOLO LECTURA (SELECT) SOBRE TABLAS OPERATIVAS Y CATÁLOGOS DE FARENET
DO $$
DECLARE
    tbl text;
    tablas_farenet text[] := ARRAY[
        -- Tablas operativas FARENET
        'persona', 'vehiculo', 'tarjetapropiedad',
        -- Catálogos vehiculares y maestros
        'categoria', 'vehiculoclase', 'marca', 'modelo', 'combustible', 'color',
        'carroceria', 'tipoplaca', 'tipoinspeccion', 'conceptoinspeccion',
        'conceptoinspecciondetalle', 'tipocertificado', 'tipoautorizacion',
        'tipodocumento', 'tipopoliza', 'aseguradora',
        -- Catálogos financieros, comerciales y ubigeo
        'moneda', 'formapago', 'cuentacorriente', 'entidadfinanciera',
        'tarjeta', 'tipocontado', 'tipodocumentoidentidad', 'pais',
        'departamento', 'provincia', 'distrito', 'seriedocumentobase'
    ];
BEGIN
    FOREACH tbl IN ARRAY tablas_farenet LOOP
        IF EXISTS (
            SELECT 1 FROM pg_tables 
            WHERE schemaname = 'public' AND tablename = tbl
        ) THEN
            EXECUTE format('GRANT SELECT ON TABLE public.%I TO faregas_app_user', tbl);
            -- Asegurar explícitamente que no existan permisos de escritura
            EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.%I FROM faregas_app_user', tbl);
        END IF;
    END LOOP;
END $$;

-- 6. PRIVILEGIOS POR DEFECTO PARA FUTURAS TABLAS
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO faregas_app_user;

-- =============================================================================
-- SECCIÓN 13: VALIDACIONES FINALES
-- =============================================================================
-- Verificación de seguridad y auditoría de privilegios
DO $$
DECLARE
    escrituras_ajenas integer;
BEGIN
    SELECT count(*) INTO escrituras_ajenas
    FROM information_schema.role_table_grants
    WHERE grantee = 'faregas_app_user'
      AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
      AND table_name NOT LIKE 'fg_%';

    IF escrituras_ajenas > 0 THEN
        RAISE EXCEPTION 'Fallo de seguridad: faregas_app_user tiene permisos de escritura en % tablas que no son fg_*', escrituras_ajenas;
    END IF;

    RAISE NOTICE 'Validación final exitosa: faregas_app_user tiene 0 privilegios de escritura en tablas de FARENET.';
    RAISE NOTICE 'Políticas de mínimos privilegios y permisos aplicados exitosamente.';
END $$;

COMMIT;

-- =============================================================================
-- APÉNDICE DE REFERENCIA HISTÓRICA Y PROPUESTAS TÉCNICAS
-- =============================================================================
-- APÉNDICE DE REFERENCIA. Las siguientes secciones son comentarios.

-- ==== migrations/005_optimizacion_eliminacion_usuarios_perfiles.sql ====
-- Referencia para instalaciones existentes. La sección 000 ya crea el resultado final de la 005.
-- -- ============================================================================
-- -- MIGRACIÓN INCREMENTAL: 005_optimizacion_eliminacion_usuarios_perfiles.sql
-- -- Sistema: FAREGAS
-- -- Objetivo: Optimizar la eliminación y reasignación de perfiles y usuarios FAREGAS:
-- --           1. fg_perfil_permiso: ON DELETE CASCADE para permisos de perfil.
-- --           2. fg_perfil_planta: ON DELETE CASCADE para sedes de perfil.
-- --           3. fg_auditoria_config: Desvincular clave foránea restrictiva para
-- --              preservar snapshots históricos de auditoría sin bloquear la
-- --              gestión de cuentas de usuarios.
-- -- Idempotencia: 100% seguro para re-ejecución sin duplicados ni pérdida de datos.
-- -- ============================================================================
--
--
-- -- 1. Cascada en permisos de perfiles (fg_perfil_permiso -> fg_perfil)
-- DO $
-- DECLARE
--     r RECORD;
-- BEGIN
--     -- Eliminar cualquier FK existente desde fg_perfil_permiso hacia fg_perfil
--     FOR r IN (
--         SELECT tc.constraint_name
--         FROM information_schema.table_constraints tc
--         JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
--         JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
--         WHERE tc.table_name = 'fg_perfil_permiso'
--           AND kcu.column_name = 'perfil_clave'
--           AND ccu.table_name = 'fg_perfil'
--     ) LOOP
--         EXECUTE 'ALTER TABLE public.fg_perfil_permiso DROP CONSTRAINT ' || quote_ident(r.constraint_name);
--     END LOOP;
--
--     -- Agregar la FK con ON DELETE CASCADE
--     ALTER TABLE public.fg_perfil_permiso
--         ADD CONSTRAINT fk_fg_pp_perfil
--         FOREIGN KEY (perfil_clave) REFERENCES public.fg_perfil(clave)
--         ON UPDATE CASCADE ON DELETE CASCADE;
-- END $;
--
-- -- 2. Cascada en plantas/sedes de perfiles (fg_perfil_planta -> fg_perfil)
-- DO $
-- DECLARE
--     r RECORD;
-- BEGIN
--     -- Eliminar cualquier FK existente desde fg_perfil_planta hacia fg_perfil
--     FOR r IN (
--         SELECT tc.constraint_name
--         FROM information_schema.table_constraints tc
--         JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
--         JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
--         WHERE tc.table_name = 'fg_perfil_planta'
--           AND kcu.column_name = 'perfil_clave'
--           AND ccu.table_name = 'fg_perfil'
--     ) LOOP
--         EXECUTE 'ALTER TABLE public.fg_perfil_planta DROP CONSTRAINT ' || quote_ident(r.constraint_name);
--     END LOOP;
--
--     -- Agregar la FK con ON DELETE CASCADE
--     ALTER TABLE public.fg_perfil_planta
--         ADD CONSTRAINT fg_perfil_planta_perfil_clave_fkey
--         FOREIGN KEY (perfil_clave) REFERENCES public.fg_perfil(clave)
--         ON UPDATE CASCADE ON DELETE CASCADE;
-- END $;
--
-- -- 3. Auditoría histórica: eliminar restricción FK para preservar el nombre de usuario
-- --    como snapshot histórico inmutable sin bloquear la baja de usuarios.
-- DO $
-- DECLARE
--     r RECORD;
-- BEGIN
--     FOR r IN (
--         SELECT tc.constraint_name
--         FROM information_schema.table_constraints tc
--         JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
--         JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
--         WHERE tc.table_name = 'fg_auditoria_config'
--           AND kcu.column_name = 'username'
--           AND ccu.table_name = 'fg_usuario'
--     ) LOOP
--         EXECUTE 'ALTER TABLE public.fg_auditoria_config DROP CONSTRAINT ' || quote_ident(r.constraint_name);
--     END LOOP;
-- END $;

-- ==== migrations/009_actualizacion_masiva_spot_productos.sql ====
-- SPOT masivo por IDs de un catálogo específico. Validar los IDs en el ambiente destino.
-- -- ============================================================================
-- -- MIGRACIÓN INCREMENTAL: 009_actualizacion_masiva_spot_productos.sql
-- -- Sistema: FAREGAS
-- -- Objetivo: Actualización masiva de clasificación fiscal SPOT en fg_producto_facturacion.
-- --           231 Servicios (Código 037, 12%), 22 Bienes (No sujetos), 22 Pendientes de revisión (NULL).
-- -- Idempotencia: 100% seguro para re-ejecución por listas explícitas de IDs.
-- -- ============================================================================
--
-- BEGIN;
-- SET LOCAL lock_timeout = '3s';
--
-- -- 1. Actualización explícita de los 231 Servicios de Certificación e Inspección (Código 037, 12.00%)
-- UPDATE public.fg_producto_facturacion
-- SET 
--     naturaleza_spot = 'SERVICIO',
--     sujeto_detraccion = true,
--     detraccion_codigo = '037',
--     detraccion_porcentaje = 12.00,
--     fecha_modificacion = CURRENT_TIMESTAMP
-- WHERE id IN (
--     1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 21, 22, 23, 24, 26, 27, 28, 29, 
--     30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 
--     54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 70, 71, 72, 75, 76, 77, 78, 79, 80, 
--     81, 82, 83, 85, 89, 90, 91, 92, 93, 94, 95, 96, 99, 100, 102, 104, 105, 106, 107, 108, 109, 110, 
--     111, 112, 113, 114, 115, 116, 117, 118, 120, 121, 122, 123, 124, 125, 126, 127, 128, 129, 130, 
--     134, 135, 136, 137, 138, 139, 140, 154, 155, 156, 163, 164, 165, 166, 167, 168, 169, 170, 171, 
--     172, 173, 174, 175, 176, 177, 178, 179, 180, 181, 182, 183, 184, 185, 186, 187, 188, 189, 190, 
--     191, 192, 193, 194, 195, 196, 197, 198, 199, 200, 201, 202, 203, 204, 205, 206, 207, 208, 209, 
--     210, 211, 212, 213, 214, 215, 216, 217, 218, 219, 220, 221, 222, 223, 224, 228, 229, 230, 231, 
--     232, 233, 234, 235, 236, 237, 238, 239, 240, 241, 242, 243, 244, 245, 246, 247, 248, 249, 250, 
--     251, 252, 253, 254, 255, 256, 2333, 2334
-- );
--
-- -- 2. Actualización explícita de los 22 Bienes Muebles No Sujetos a SPOT (Chips y Hojas)
-- UPDATE public.fg_producto_facturacion
-- SET 
--     naturaleza_spot = 'BIEN',
--     sujeto_detraccion = false,
--     detraccion_codigo = NULL,
--     detraccion_porcentaje = NULL,
--     fecha_modificacion = CURRENT_TIMESTAMP
-- WHERE id IN (
--     25, 69, 73, 74, 86, 87, 88, 97, 101, 103, 131, 132, 133, 160, 161, 162, 225, 226, 227, 2335, 2336, 2337
-- );
--
-- -- 3. Los 22 casos pendientes (7 no estándar + 15 notariales) permanecen intactos en NULL:
-- -- IDs: 19, 20, 119, 157, 158, 159, 2312, 84, 98, 141, 142, 143, 144, 145, 146, 147, 148, 149, 150, 151, 152, 153
--
-- COMMIT;

-- ==== 20261111_faregas_cortesias_notificaciones.pending.sql ====
-- Migración pendiente de aprobación para notificaciones de cortesías.
-- BEGIN;
--
-- INSERT INTO public.fg_permiso (clave, nombre, modulo, descripcion, activo)
-- VALUES (
--     'FAREGAS_NOTIFICACION_CORTESIA_RECIBIR',
--     'Recibir notificaciones de cortesías',
--     'FAREGAS',
--     'Recibe avisos informativos cuando se emite una cortesía en una sede autorizada. No autoriza a emitir cortesías.',
--     TRUE
-- )
-- ON CONFLICT (clave) DO UPDATE
-- SET nombre = EXCLUDED.nombre,
--     modulo = EXCLUDED.modulo,
--     descripcion = EXCLUDED.descripcion,
--     activo = EXCLUDED.activo;
--
-- INSERT INTO public.fg_descuento (
--     codigo, nombre, tipo, tipo_calculo, valor,
--     fecha_inicio, fecha_fin, activo, usuario_creacion
-- )
-- SELECT
--     'CORTESIA_FAREGAS',
--     'CORTESÍA FAREGAS',
--     'PROMOCION',
--     'PORCENTAJE',
--     100,
--     TIMESTAMP '2020-01-01 00:00:00',
--     TIMESTAMP '2099-12-31 23:59:59',
--     TRUE,
--     'MIGRACION_FAREGAS'
-- WHERE NOT EXISTS (
--     SELECT 1
--     FROM public.fg_descuento
--     WHERE UPPER(BTRIM(codigo)) = 'CORTESIA_FAREGAS'
-- );
--
-- UPDATE public.fg_descuento
-- SET nombre = 'CORTESÍA FAREGAS',
--     tipo = 'PROMOCION',
--     tipo_calculo = 'PORCENTAJE',
--     valor = 100,
--     activo = TRUE,
--     fecha_modificacion = CURRENT_TIMESTAMP,
--     usuario_modificacion = 'MIGRACION_FAREGAS'
-- WHERE UPPER(BTRIM(codigo)) = 'CORTESIA_FAREGAS';
--
-- COMMIT;

-- ==== faregas_roles_postgresql.template.sql ====
-- Plantilla administrativa de roles, privilegios y propiedad de objetos.
-- -- PLANTILLA PARA REVISIÓN DBA. NO EJECUTAR SIN VENTANA Y APROBACIÓN.
-- -- Ejecutar con psql conectado a la base objetivo, usando un DBA.
-- -- No cambia la conexión activa de la aplicación ni revoca privilegios a otros roles.
-- -- Antes de aplicar: revisar membresías, privilegios de PUBLIC, dueños de tablas,
-- -- tablas/funciones adicionales requeridas por el despliegue y el resultado del
-- -- bloque de verificación del final.
-- -- Plantilla de una sola aplicación: verificar que estos cuatro roles no existan.
--
-- CREATE ROLE faregas_app
--     NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
--
-- CREATE ROLE faregas_runtime
--     LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
--
-- CREATE ROLE faregas_migrator
--     NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
--
-- CREATE ROLE faregas_migration
--     LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
--
-- \password faregas_runtime
-- \password faregas_migration
--
-- GRANT faregas_app TO faregas_runtime;
-- GRANT faregas_migrator TO faregas_migration;
-- GRANT CONNECT ON DATABASE inspeccion TO faregas_app;
-- GRANT CONNECT ON DATABASE inspeccion TO faregas_migrator;
-- REVOKE CREATE, TEMPORARY ON DATABASE inspeccion FROM faregas_app;
-- REVOKE CREATE, TEMPORARY ON DATABASE inspeccion FROM faregas_migrator;
-- GRANT USAGE ON SCHEMA public TO faregas_app;
-- REVOKE CREATE ON SCHEMA public FROM faregas_app;
-- GRANT USAGE, CREATE ON SCHEMA public TO faregas_migrator;
--
-- -- Limpiar concesiones directas previas a este grupo sin tocar otros roles.
-- REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM faregas_app;
-- REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM faregas_app;
--
-- -- FAREGAS puede operar sus tablas y consumir sus secuencias.
-- DO $faregas_grants$
-- DECLARE
--     obj record;
-- BEGIN
--     FOR obj IN
--         SELECT schemaname, tablename
--         FROM pg_tables
--         WHERE schemaname = 'public'
--           AND tablename LIKE 'fg\_%' ESCAPE '\'
--     LOOP
--         EXECUTE format(
--             'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %I.%I TO faregas_app',
--             obj.schemaname, obj.tablename
--         );
--     END LOOP;
--
--     FOR obj IN
--         SELECT n.nspname AS schemaname, c.relname AS sequencename
--         FROM pg_class c
--         JOIN pg_namespace n ON n.oid = c.relnamespace
--         WHERE n.nspname = 'public'
--           AND c.relkind = 'S'
--           AND c.relname LIKE 'fg\_%' ESCAPE '\'
--     LOOP
--         EXECUTE format(
--             'GRANT USAGE, SELECT ON SEQUENCE %I.%I TO faregas_app',
--             obj.schemaname, obj.sequencename
--         );
--     END LOOP;
-- END;
-- $faregas_grants$;
--
-- -- Transferir propiedad solo de objetos FAREGAS existentes al rol de
-- -- migraciones. Esto le da DDL sobre fg_* y no sobre objetos heredados.
-- DO $faregas_owners$
-- DECLARE
--     obj record;
-- BEGIN
--     FOR obj IN
--         SELECT schemaname, tablename
--         FROM pg_tables
--         WHERE schemaname = 'public'
--           AND tablename LIKE 'fg\_%' ESCAPE '\'
--     LOOP
--         EXECUTE format('ALTER TABLE %I.%I OWNER TO faregas_migrator', obj.schemaname, obj.tablename);
--     END LOOP;
--
--     FOR obj IN
--         SELECT n.nspname AS schemaname, c.relname AS sequencename
--         FROM pg_class c
--         JOIN pg_namespace n ON n.oid = c.relnamespace
--         WHERE n.nspname = 'public'
--           AND c.relkind = 'S'
--           AND c.relname LIKE 'fg\_%' ESCAPE '\'
--     LOOP
--         EXECUTE format('ALTER SEQUENCE %I.%I OWNER TO faregas_migrator', obj.schemaname, obj.sequencename);
--     END LOOP;
--
--     FOR obj IN
--         SELECT n.nspname AS schemaname, p.proname,
--                pg_get_function_identity_arguments(p.oid) AS argumentos
--         FROM pg_proc p
--         JOIN pg_namespace n ON n.oid = p.pronamespace
--         WHERE n.nspname = 'public'
--           AND p.proname LIKE 'fg\_%' ESCAPE '\'
--     LOOP
--         EXECUTE format(
--             'ALTER FUNCTION %I.%I(%s) OWNER TO faregas_migrator',
--             obj.schemaname, obj.proname, obj.argumentos
--         );
--     END LOOP;
-- END;
-- $faregas_owners$;
--
-- -- Cada migración futura debe otorgar DML al grupo solo sobre las nuevas tablas
-- -- fg_* creadas por ella. No usar ALTER DEFAULT PRIVILEGES sobre todo public.
--
-- -- Tablas heredadas usadas por FAREGAS como fuente de consulta/FK.
-- GRANT SELECT ON TABLE
--     public.persona,
--     public.vehiculo,
--     public.tarjetapropiedad,
--     public.categoria,
--     public.vehiculoclase,
--     public.marca,
--     public.modelo,
--     public.combustible,
--     public.color,
--     public.carroceria,
--     public.moneda,
--     public.formapago,
--     public.cuentacorriente,
--     public.entidadfinanciera,
--     public.tarjeta,
--     public.tipocontado,
--     public.seriedocumentobase,
--     public.tipodocumentoidentidad,
--     public.pais,
--     public.departamento,
--     public.provincia,
--     public.distrito
-- TO faregas_app;
--
-- GRANT SELECT, REFERENCES ON TABLE
--     public.persona,
--     public.vehiculo,
--     public.tarjetapropiedad,
--     public.categoria,
--     public.vehiculoclase,
--     public.marca,
--     public.modelo,
--     public.combustible,
--     public.color,
--     public.carroceria,
--     public.moneda,
--     public.formapago,
--     public.cuentacorriente,
--     public.entidadfinanciera,
--     public.tarjeta,
--     public.tipocontado,
--     public.seriedocumentobase,
--     public.tipodocumentoidentidad,
--     public.pais,
--     public.departamento,
--     public.provincia,
--     public.distrito
-- TO faregas_migrator;
--
-- -- Garantía ejecutable: la plantilla debe abortar si faregas_runtime recibe
-- -- escritura sobre cualquier tabla heredada, incluso por PUBLIC o por otra
-- -- membresía agregada antes de ejecutar este bloque.
-- DO $faregas_runtime_sin_escritura_legacy$
-- DECLARE
--     tabla_con_escritura text;
-- BEGIN
--     SELECT table_name
--     INTO tabla_con_escritura
--     FROM information_schema.tables
--     WHERE table_schema = 'public'
--       AND table_type = 'BASE TABLE'
--       AND table_name NOT LIKE 'fg\_%' ESCAPE '\'
--       AND (
--           has_table_privilege('faregas_runtime', format('public.%I', table_name), 'INSERT')
--           OR has_table_privilege('faregas_runtime', format('public.%I', table_name), 'UPDATE')
--           OR has_table_privilege('faregas_runtime', format('public.%I', table_name), 'DELETE')
--           OR has_table_privilege('faregas_runtime', format('public.%I', table_name), 'TRUNCATE')
--       )
--     ORDER BY table_name
--     LIMIT 1;
--
--     IF tabla_con_escritura IS NOT NULL THEN
--         RAISE EXCEPTION
--             'faregas_runtime conserva permisos de escritura sobre la tabla heredada public.%',
--             tabla_con_escritura;
--     END IF;
-- END;
-- $faregas_runtime_sin_escritura_legacy$;
--
-- -- Verificación posterior. Todo debe devolver false para permisos de escritura
-- -- heredados; inspeccionar y resolver cualquier true antes de conectar la app.
-- SELECT table_name,
--        has_table_privilege('faregas_runtime', format('public.%I', table_name), 'INSERT') AS puede_insertar,
--        has_table_privilege('faregas_runtime', format('public.%I', table_name), 'UPDATE') AS puede_actualizar,
--        has_table_privilege('faregas_runtime', format('public.%I', table_name), 'DELETE') AS puede_eliminar,
--        has_table_privilege('faregas_runtime', format('public.%I', table_name), 'TRUNCATE') AS puede_truncar
-- FROM information_schema.tables
-- WHERE table_schema = 'public'
--   AND table_type = 'BASE TABLE'
--   AND table_name NOT LIKE 'fg\_%' ESCAPE '\'
-- ORDER BY table_name;
--
-- -- Este grupo no debe ser dueño de objetos ni miembro de roles adicionales con
-- -- permisos de escritura heredados. Revisar también permisos concedidos a PUBLIC.
-- SELECT r.rolname, r.rolsuper, r.rolcreatedb, r.rolcreaterole,
--        pg_get_userbyid(m.roleid) AS miembro_de
-- FROM pg_roles r
-- LEFT JOIN pg_auth_members m ON m.member = r.oid
-- WHERE r.rolname IN ('faregas_runtime', 'faregas_app', 'faregas_migration', 'faregas_migrator');
--
-- -- Dejar las contraseñas fuera del historial de shell: \password las solicita
-- -- de forma interactiva. Tras aprobar el diseño, configurar faregasBackend/.env
-- -- con el login runtime. No otorgar membresía migradora al runtime.

-- ==== scripts/20261109_fecha_hora_emision_propuesta.sql ====
-- Propuesta de fecha y hora de emisión para revisión.
-- BEGIN;
--
-- -- 1. Tiempos límite de protección para evitar contención en base compartida
-- SET LOCAL lock_timeout = '5s';
-- SET LOCAL statement_timeout = '10s';
--
-- -- 2. Modificaciones aditivas estrictas (sin DEFAULT NOW(), sin tocar datos históricos)
-- ALTER TABLE public.fg_certificado
-- ADD COLUMN IF NOT EXISTS fecha_hora_emision TIMESTAMPTZ;
--
-- ALTER TABLE public.fg_facturacion
-- ADD COLUMN IF NOT EXISTS fecha_hora_emision TIMESTAMPTZ;
--
-- -- 3. Documentación en catálogo
-- COMMENT ON COLUMN public.fg_certificado.fecha_hora_emision IS 'Instante real de emisión (transacción BORRADOR->EMITIDO). NULL=histórico sin hora.';
-- COMMENT ON COLUMN public.fg_facturacion.fecha_hora_emision IS 'Instante local de generación del comprobante (registro creado). NULL=sin registro.';
--
-- -- 4. Verificación de integridad dentro de la transacción
-- DO $$
-- BEGIN
--     IF NOT EXISTS (
--         SELECT 1 FROM information_schema.columns 
--         WHERE table_schema = 'public' AND table_name = 'fg_certificado' AND column_name = 'fecha_hora_emision'
--     ) THEN
--         RAISE EXCEPTION 'ERROR_MIGRACION: No se creó la columna fecha_hora_emision en fg_certificado';
--     END IF;
--
--     IF NOT EXISTS (
--         SELECT 1 FROM information_schema.columns 
--         WHERE table_schema = 'public' AND table_name = 'fg_facturacion' AND column_name = 'fecha_hora_emision'
--     ) THEN
--         RAISE EXCEPTION 'ERROR_MIGRACION: No se creó la columna fecha_hora_emision en fg_facturacion';
--     END IF;
-- END $$;
--
-- COMMIT;

-- ==== scripts/propuesta_backfill_fg_vehiculo.sql ====
-- Propuesta de actualización de datos históricos de vehículos para revisión.
-- -- PROPUESTA DE BACKFILL MANUAL. NO SE EJECUTA AUTOMATICAMENTE.
-- -- Revisar y autorizar expresamente antes de usar en cada ambiente.
-- -- Solo lee/escribe tablas del dominio FAREGAS (fg_*).
--
-- BEGIN;
--
-- WITH candidatos AS (
--     SELECT
--         v.*,
--         c.estado,
--         c.fecha_emision,
--         c.fecha_creacion,
--         c.usuario_creacion,
--         (
--             CASE WHEN NULLIF(BTRIM(v.marca), '') IS NOT NULL THEN 1 ELSE 0 END +
--             CASE WHEN NULLIF(BTRIM(v.modelo), '') IS NOT NULL THEN 1 ELSE 0 END +
--             CASE WHEN NULLIF(BTRIM(v.anio_fabricacion), '') IS NOT NULL THEN 1 ELSE 0 END +
--             CASE WHEN NULLIF(BTRIM(v.numero_motor), '') IS NOT NULL THEN 1 ELSE 0 END +
--             CASE WHEN NULLIF(BTRIM(v.combustible), '') IS NOT NULL THEN 1 ELSE 0 END +
--             CASE WHEN NULLIF(BTRIM(v.vin), '') IS NOT NULL
--                       OR NULLIF(BTRIM(v.serie_chasis), '') IS NOT NULL THEN 1 ELSE 0 END +
--             CASE WHEN NULLIF(BTRIM(v.clase), '') IS NOT NULL THEN 1 ELSE 0 END +
--             CASE WHEN NULLIF(BTRIM(v.carroceria), '') IS NOT NULL THEN 1 ELSE 0 END +
--             CASE WHEN v.numero_ejes IS NOT NULL THEN 1 ELSE 0 END +
--             CASE WHEN v.numero_ruedas IS NOT NULL THEN 1 ELSE 0 END
--         ) AS completitud
--     FROM fg_certificado_vehiculo v
--     JOIN fg_certificado c ON c.id = v.certificado_id
--     WHERE NULLIF(BTRIM(v.placa), '') IS NOT NULL
-- ), elegidos AS (
--     SELECT *,
--            ROW_NUMBER() OVER (
--                PARTITION BY UPPER(BTRIM(placa))
--                ORDER BY
--                    CASE WHEN estado = 'EMITIDO' THEN 0 ELSE 1 END,
--                    CASE WHEN estado = 'EMITIDO' THEN fecha_emision END DESC NULLS LAST,
--                    fecha_creacion DESC,
--                    completitud DESC
--            ) AS prioridad
--     FROM candidatos
--     WHERE completitud >= 5
-- )
-- INSERT INTO fg_vehiculo (
--     placa, categoria, clase, marca, modelo, version, anio_fabricacion,
--     anio_modelo, vin, serie_chasis, numero_motor, combustible, color,
--     carroceria, numero_cilindros, cilindrada, numero_ejes, numero_ruedas,
--     numero_asientos, numero_pasajeros, longitud, ancho, alto, peso_neto,
--     peso_bruto, carga_util, potencia, formula_rodante, fuente_ultima,
--     certificado_origen_id, confirmado, usuario_creacion, usuario_modificacion
-- )
-- SELECT
--     placa, categoria, clase, marca, modelo, version, anio_fabricacion,
--     anio_modelo, vin, serie_chasis, numero_motor, combustible, color,
--     carroceria, numero_cilindros, cilindrada, numero_ejes, numero_ruedas,
--     numero_asientos, numero_pasajeros, longitud, ancho, alto, peso_neto,
--     peso_bruto, carga_util, potencia, formula_rodante, 'FAREGAS',
--     certificado_id, estado = 'EMITIDO', usuario_creacion, usuario_creacion
-- FROM elegidos
-- WHERE prioridad = 1
-- ON CONFLICT (placa_normalizada) DO NOTHING;
--
-- -- Sustituir por ROLLBACK durante la revisión previa si se desea validar el resultado.
-- COMMIT;

-- ==== faregas_instalacion_completa.sql ====
-- Instalador alternativo del 2026-11-06. Duplica el esquema base y requiere catálogos FARENET ya provisionados.
-- -- ============================================================================
-- -- FAREGAS - INSTALACION COMPLETA
-- -- Estado final consolidado y revisado el 2026-11-06.
-- -- Contiene 69 tablas funcionales, secuencias, claves, restricciones, indices,
-- -- funciones, triggers y catálogos de permisos propios de FAREGAS.
-- --
-- -- Prerrequisito: el esquema legacy Farenet debe existir porque FAREGAS conserva
-- -- claves foraneas hacia moneda, formapago, cuentacorriente, entidadfinanciera,
-- -- tarjeta, tipocontado y persona.
-- --
-- -- Este archivo es exclusivo para instalaciones nuevas. No se debe combinar
-- -- con migrations/ ni migrations_history/. No contiene clientes, vehiculos,
-- -- usuarios, certificados, pagos, comprobantes, contraseñas, tokens ni otros
-- -- datos transaccionales.
-- --
-- -- Incluye el catálogo RBAC de aplicación. Empresa, sedes, servicios, productos,
-- -- tarifas, talleres, series y correlativos son configuración específica del
-- -- despliegue y deben provisionarse en un procedimiento posterior controlado.
-- -- ============================================================================
--
-- BEGIN;
--
-- --
-- -- PostgreSQL database dump
-- --
--
-- -- Dumped from database version 13.23
-- -- Dumped by pg_dump version 16.4
--
-- SET statement_timeout = 0;
-- SET lock_timeout = 0;
-- SET idle_in_transaction_session_timeout = 0;
-- SET client_encoding = 'UTF8';
-- SET standard_conforming_strings = on;
-- SELECT pg_catalog.set_config('search_path', '', false);
-- SET check_function_bodies = false;
-- SET xmloption = content;
-- SET client_min_messages = warning;
-- SET row_security = off;
--
--
-- -- FAREGAS consume esta cuenta a través de la FK de fg_pago, pero no debe
-- -- provisionarla ni actualizarla desde una migración. Un administrador de
-- -- FARENET debe preparar y validar la fila heredada antes del despliegue.
-- -- Esta comprobación es de solo lectura y falla con un mensaje claro si falta.
-- DO $faregas_cuenta_preflight$
-- BEGIN
--     IF NOT EXISTS (
--         SELECT 1
--         FROM public.cuentacorriente
--         WHERE key = 'FG_BBVA_00020564'
--           AND nroctacorriente = '0011-0397-0100020564'
--           AND entidadfinanciera_key = '6'
--           AND moneda_key = 'sol'
--           AND empresa_key = 'FAREGAS'
--     ) THEN
--         RAISE EXCEPTION 'Falta provisionar la cuenta bancaria FAREGAS en el catálogo FARENET antes de instalar el esquema';
--     END IF;
-- END;
-- $faregas_cuenta_preflight$;
--
--
-- -- Funcion requerida por el trigger inmutable del inventario por cantidad.
-- CREATE OR REPLACE FUNCTION public.fg_bloquear_mutacion_movimiento_inventario_cantidad()
-- RETURNS trigger
-- LANGUAGE plpgsql
-- AS $function$
-- BEGIN
--     RAISE EXCEPTION 'Los movimientos de inventario por cantidad son inmutables';
-- END;
-- $function$;
--
-- SET default_tablespace = '';
--
-- SET default_table_access_method = heap;
--
-- --
-- -- Name: fg_auditoria_acceso; Type: TABLE; Schema: public; Owner: -
-- --
--
-- CREATE TABLE public.fg_auditoria_acceso (
--     id bigint NOT NULL,
--     username character varying(255),
--     evento character varying(50) NOT NULL,
--     exitoso boolean NOT NULL,
--     mensaje text,
--     planta_key character varying(20),
--     ip_direccion character varying(45),
--     user_agent character varying(1000),
--     fecha_evento timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
--     categoria character varying(30) DEFAULT 'ACCESO'::character varying NOT NULL,
--     entidad character varying(50),
--     entidad_id bigint,
--     certificado_id bigint,
--     numero_certificado character varying(80),
--     placa character varying(20),
--     tipo_certificado character varying(50),
--     paso character varying(50),
--     datos jsonb,
--     perfil character varying(50)
-- );
--
--
-- --
-- -- Name: TABLE fg_auditoria_acceso; Type: COMMENT; Schema: public; Owner: -
-- --
--
-- COMMENT ON TABLE public.fg_auditoria_acceso IS 'Bitácora inmutable de accesos y operaciones relevantes del subsistema FAREGAS';
--
--
-- --
-- -- Name: COLUMN fg_auditoria_acceso.datos; Type: COMMENT; Schema: public; Owner: -
-- --
--
-- COMMENT ON COLUMN public.fg_auditoria_acceso.datos IS 'Resumen técnico no sensible del evento; no debe almacenar contraseñas, tokens ni datos completos de pago';
--
--
-- --
-- -- Name: COLUMN fg_auditoria_acceso.perfil; Type: COMMENT; Schema: public; Owner: -
-- --
--
-- COMMENT ON COLUMN public.fg_auditoria_acceso.perfil IS 'Perfil histórico que tenía el usuario al momento de la operación';
--
--
-- --
-- -- Name: fg_auditoria_acceso_id_seq; Type: SEQUENCE; Schema: public; Owner: -
-- --
--
-- CREATE SEQUENCE public.fg_auditoria_acceso_id_seq
--     START WITH 1
--     INCREMENT BY 1
--     NO MINVALUE
--     NO MAXVALUE
--     CACHE 1;
--
--
-- --
-- -- Name: fg_auditoria_acceso_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
-- --
--
-- ALTER SEQUENCE public.fg_auditoria_acceso_id_seq OWNED BY public.fg_auditoria_acceso.id;
--
--
-- --
-- -- Name: fg_auditoria_config; Type: TABLE; Schema: public; Owner: -
-- --
--
-- CREATE TABLE public.fg_auditoria_config (
--     id bigint NOT NULL,
--     username character varying(255) NOT NULL,
--     entidad character varying(50) NOT NULL,
--     accion character varying(50) NOT NULL,
--     identificador character varying(100) NOT NULL,
--     detalles jsonb,
--     planta_key character varying(20),
--     fecha timestamp with time zone DEFAULT now() NOT NULL,
--     ip_direccion character varying(50)
-- );
--
--
-- --
-- -- Name: fg_auditoria_config_id_seq; Type: SEQUENCE; Schema: public; Owner: -
-- --
--
-- CREATE SEQUENCE public.fg_auditoria_config_id_seq
--     START WITH 1
--     INCREMENT BY 1
--     NO MINVALUE
--     NO MAXVALUE
--     CACHE 1;
--
--
-- --
-- -- Name: fg_auditoria_config_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
-- --
--
-- ALTER SEQUENCE public.fg_auditoria_config_id_seq OWNED BY public.fg_auditoria_config.id;
--
--
-- --
-- -- Name: fg_categoria_servicio; Type: TABLE; Schema: public; Owner: -
-- --
--
-- CREATE TABLE public.fg_categoria_servicio (
--     id integer NOT NULL,
--     codigo character varying(50) NOT NULL,
--     nombre character varying(100) NOT NULL,
--     descripcion text,
--     activo boolean DEFAULT true NOT NULL,
--     orden integer DEFAULT 0 NOT NULL,
--     fecha_creacion timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
--     fecha_modificacion timestamp without time zone
-- );
--
--
-- --
-- -- Name: fg_categoria_servicio_id_seq; Type: SEQUENCE; Schema: public; Owner: -
-- --
--
-- ALTER TABLE public.fg_categoria_servicio ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
--     SEQUENCE NAME public.fg_categoria_servicio_id_seq
--     START WITH 1
--     INCREMENT BY 1
--     NO MINVALUE
--     NO MAXVALUE
--     CACHE 1
-- );
--
--
-- --
-- -- Name: fg_certificado; Type: TABLE; Schema: public; Owner: -
-- --
--
-- CREATE TABLE public.fg_certificado (
--     id bigint NOT NULL,
--     tipo_certificado_clave character varying(30) NOT NULL,
--     numero_certificado character varying(50),
--     cliente_id bigint,
--     planta_key character varying(20) NOT NULL,
--     fecha_emision date,
--     fecha_hora_emision timestamptz,
--     estado character varying(30),
--     observaciones text,
--     usuario_creacion character varying(255) NOT NULL,
--     fecha_creacion timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
--     usuario_modificacion character varying(255),
--     fecha_modificacion timestamp without time zone,
--     entidad_certificadora_nombre character varying(300),
--     resolucion_directoral character varying(150),
--     domicilio_fiscal character varying(500),
--     telefono_certificadora character varying(30),
--     lugar_emision character varying(150),
--     tarifa_codigo character varying(50),
--     paso_actual character varying(40) DEFAULT 'DATOS_INICIALES'::character varying NOT NULL,
--     formato_version_id integer,
--     formato_datos_snapshot jsonb,
--     producto_facturacion_certificado_id bigint,
--     precio_certificado numeric(10,2),
--     producto_chip_id bigint,
--     producto_facturacion_chip_id bigint,
--     precio_chip numeric(10,2),
--     importe_total numeric(10,2),
--     fecha_anulacion timestamp with time zone,
--     motivo_anulacion character varying(500),
--     solicitud_anulacion_id bigint,
--     usuario_anulacion character varying(255),
--     CONSTRAINT ck_fg_certificado_paso_actual CHECK (((paso_actual)::text = ANY ((ARRAY['DATOS_INICIALES'::character varying, 'PAGO'::character varying, 'VEHICULO'::character varying, 'FACTURACION'::character varying, 'PREVISUALIZACION'::character varying, 'VERIFICACION_EMISION'::character varying])::text[])))
-- );
--
--
-- --
-- -- Name: fg_certificado_chip; Type: TABLE; Schema: public; Owner: -
-- --
--
-- CREATE TABLE public.fg_certificado_chip (
--     certificado_id bigint NOT NULL,
--     chip_id bigint NOT NULL,
--     fecha_asociacion timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
-- );
--
--
-- --
-- -- Name: fg_certificado_conformidad; Type: TABLE; Schema: public; Owner: -
-- --
--
-- CREATE TABLE public.fg_certificado_conformidad (
--     certificado_id bigint NOT NULL,
--     tipo_conformidad character varying(30),
--     tipo_tramite character varying(200),
--     caracteristica_registrable character varying(300),
--     motivo text,
--     descripcion text,
--     uso_original_vehiculo character varying(200),
--     marca_modificacion boolean DEFAULT false,
--     marca_montaje boolean DEFAULT false,
--     marca_fabricacion boolean DEFAULT false
-- );
--
--
-- --
-- -- Name: fg_certificado_formato; Type: TABLE; Schema: public; Owner: -
-- --
--
-- CREATE TABLE public.fg_certificado_formato (
--     id integer NOT NULL,
--     codigo character varying(50) NOT NULL,
--     nombre character varying(150) NOT NULL,
--     motor character varying(30) NOT NULL,
--     es_protegido boolean DEFAULT false,
--     activo boolean DEFAULT true,
--     creado_en timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
--     actualizado_en timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
--     formato_padre_id integer,
--     CONSTRAINT fg_certificado_formato_motor_check CHECK (((motor)::text = ANY ((ARRAY['SISTEMA'::character varying, 'DOCX_DINAMICO'::character varying, 'HTML_DINAMICO'::character varying])::text[])))
-- );
--
--
-- --
-- -- Name: fg_certificado_formato_id_seq; Type: SEQUENCE; Schema: public; Owner: -
-- --
--
-- CREATE SEQUENCE public.fg_certificado_formato_id_seq
--     AS integer
--     START WITH 1
--     INCREMENT BY 1
--     NO MINVALUE
--     NO MAXVALUE
--     CACHE 1;
--
--
-- --
-- -- Name: fg_certificado_formato_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
-- --
--
-- ALTER SEQUENCE public.fg_certificado_formato_id_seq OWNED BY public.fg_certificado_formato.id;
--
--
-- --
-- -- Name: fg_certificado_formato_version; Type: TABLE; Schema: public; Owner: -
-- --
--
-- CREATE TABLE public.fg_certificado_formato_version (
--     id integer NOT NULL,
--     formato_id integer NOT NULL,
--     version integer NOT NULL,
--     archivo_ruta character varying(255),
--     configuracion jsonb,
--     estado character varying(20) NOT NULL,
--     vigente_desde timestamp without time zone,
--     creado_por integer,
--     creado_en timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
--     motor character varying(50),
--     CONSTRAINT fg_certificado_formato_version_estado_check CHECK (((estado)::text = ANY ((ARRAY['BORRADOR'::character varying, 'VIGENTE'::character varying, 'RETIRADA'::character varying])::text[])))
-- );
--
--
-- --
-- -- Name: fg_certificado_formato_version_id_seq; Type: SEQUENCE; Schema: public; Owner: -
-- --
--
-- CREATE SEQUENCE public.fg_certificado_formato_version_id_seq
--     AS integer
--     START WITH 1
--     INCREMENT BY 1
--     NO MINVALUE
--     NO MAXVALUE
--     CACHE 1;
--
--
-- --
-- -- Name: fg_certificado_formato_version_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
-- --
--
-- ALTER SEQUENCE public.fg_certificado_formato_version_id_seq OWNED BY public.fg_certificado_formato_version.id;
--
--
-- --
-- -- Name: fg_certificado_glp; Type: TABLE; Schema: public; Owner: -
-- --
--
-- CREATE TABLE public.fg_certificado_glp (
--     certificado_id bigint NOT NULL,
--     taller_autorizado_id bigint,
--     expediente_tecnico character varying(100),
--     vigencia_hasta date,
--     taller_razon_social character varying(300),
--     taller_sede character varying(200),
--     taller_direccion character varying(500),
--     taller_codigo_autorizacion character varying(100),
--     modalidad character varying(20),
--     combustible_posterior character varying(100),
--     peso_neto_posterior character varying(50),
--     carga_util_posterior character varying(50)
-- );
--
--
-- --
-- -- Name: fg_certificado_glp_componente; Type: TABLE; Schema: public; Owner: -
-- --
--
-- CREATE TABLE public.fg_certificado_glp_componente (
--     id bigint NOT NULL,
--     certificado_id bigint NOT NULL,
--     orden smallint NOT NULL,
--     componente character varying(100) NOT NULL,
--     marca character varying(150),
--     modelo character varying(150),
--     capacidad_litros numeric(10,2),
--     mes_fabricacion smallint,
--     anio_fabricacion smallint,
--     numero_serie character varying(200),
--     CONSTRAINT fg_certificado_glp_componente_mes_fabricacion_check CHECK (((mes_fabricacion IS NULL) OR ((mes_fabricacion >= 1) AND (mes_fabricacion <= 12))))
-- );
--
--
-- --
-- -- Name: fg_certificado_glp_componente_id_seq; Type: SEQUENCE; Schema: public; Owner: -
-- --
--
-- CREATE SEQUENCE public.fg_certificado_glp_componente_id_seq
--     START WITH 1
--     INCREMENT BY 1
--     NO MINVALUE
--     NO MAXVALUE
--     CACHE 1;
--
--
-- --
-- -- Name: fg_certificado_glp_componente_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
-- --
--
-- ALTER SEQUENCE public.fg_certificado_glp_componente_id_seq OWNED BY public.fg_certificado_glp_componente.id;
--
--
-- --
-- -- Name: fg_certificado_glp_verificacion; Type: TABLE; Schema: public; Owner: -
-- --
--
-- CREATE TABLE public.fg_certificado_glp_verificacion (
--     id bigint NOT NULL,
--     certificado_id bigint NOT NULL,
--     codigo character varying(5) NOT NULL,
--     orden smallint NOT NULL,
--     descripcion text NOT NULL,
--     cumple boolean,
--     observacion text
-- );
--
--
-- --
-- -- Name: fg_certificado_glp_verificacion_id_seq; Type: SEQUENCE; Schema: public; Owner: -
-- --
--
-- CREATE SEQUENCE public.fg_certificado_glp_verificacion_id_seq
--     START WITH 1
--     INCREMENT BY 1
--     NO MINVALUE
--     NO MAXVALUE
--     CACHE 1;
--
--
-- --
-- -- Name: fg_certificado_glp_verificacion_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
-- --
--
-- ALTER SEQUENCE public.fg_certificado_glp_verificacion_id_seq OWNED BY public.fg_certificado_glp_verificacion.id;
--
--
-- --
-- -- Name: fg_certificado_gnv; Type: TABLE; Schema: public; Owner: -
-- --
--
-- CREATE TABLE public.fg_certificado_gnv (
--     certificado_id bigint NOT NULL,
--     taller_autorizado_id bigint,
--     vigencia_hasta date,
--     taller_razon_social character varying(300),
--     taller_sede character varying(200),
--     taller_direccion character varying(500),
--     taller_codigo_autorizacion character varying(100),
--     modalidad character varying(20),
--     numero_chip character varying(15),
--     combustible_posterior character varying(100),
--     peso_neto_posterior character varying(50),
--     observaciones character varying(250),
--     taller_planta_key character varying(20)
-- );
--
--
-- --
-- -- Name: COLUMN fg_certificado_gnv.observaciones; Type: COMMENT; Schema: public; Owner: -
-- --
--
-- COMMENT ON COLUMN public.fg_certificado_gnv.observaciones IS 'Observaciones del certificado GNV escritas por el inspector. Opcional. Limite 250 caracteres.';
--
--
-- --
-- -- Name: fg_certificado_gnv_componente; Type: TABLE; Schema: public; Owner: -
-- --
--
-- CREATE TABLE public.fg_certificado_gnv_componente (
--     id bigint NOT NULL,
--     certificado_id bigint NOT NULL,
--     orden integer NOT NULL,
--     componente character varying(100) NOT NULL,
--     marca character varying(150),
--     modelo character varying(150),
--     capacidad_litros character varying(100),
--     mes_fabricacion integer,
--     anio_fabricacion integer,
--     numero_serie character varying(150),
--     CONSTRAINT fg_certificado_gnv_componente_mes_fabricacion_check CHECK (((mes_fabricacion >= 1) AND (mes_fabricacion <= 12)))
-- );
--
--
-- --
-- -- Name: fg_certificado_gnv_componente_id_seq; Type: SEQUENCE; Schema: public; Owner: -
-- --
--
-- CREATE SEQUENCE public.fg_certificado_gnv_componente_id_seq
--     START WITH 1
--     INCREMENT BY 1
--     NO MINVALUE
--     NO MAXVALUE
--     CACHE 1;
--
--
-- --
-- -- Name: fg_certificado_gnv_componente_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
-- --
--
-- ALTER SEQUENCE public.fg_certificado_gnv_componente_id_seq OWNED BY public.fg_certificado_gnv_componente.id;
--
--
-- --
-- -- Name: fg_certificado_gnv_verificacion; Type: TABLE; Schema: public; Owner: -
-- --
--
-- CREATE TABLE public.fg_certificado_gnv_verificacion (
--     id bigint NOT NULL,
--     certificado_id bigint NOT NULL,
--     codigo character varying(5) NOT NULL,
--     orden smallint NOT NULL,
--     descripcion text NOT NULL,
--     cumple boolean,
--     observacion text
-- );
--
--
-- --
-- -- Name: fg_certificado_gnv_verificacion_id_seq; Type: SEQUENCE; Schema: public; Owner: -
-- --
--
-- CREATE SEQUENCE public.fg_certificado_gnv_verificacion_id_seq
--     START WITH 1
--     INCREMENT BY 1
--     NO MINVALUE
--     NO MAXVALUE
--     CACHE 1;
--
--
-- --
-- -- Name: fg_certificado_gnv_verificacion_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
-- --
--
-- ALTER SEQUENCE public.fg_certificado_gnv_verificacion_id_seq OWNED BY public.fg_certificado_gnv_verificacion.id;
--
--
-- --
-- -- Name: fg_certificado_id_seq; Type: SEQUENCE; Schema: public; Owner: -
-- --
--
-- CREATE SEQUENCE public.fg_certificado_id_seq
--     START WITH 1
--     INCREMENT BY 1
--     NO MINVALUE
--     NO MAXVALUE
--     CACHE 1;
--
--
-- --
-- -- Name: fg_certificado_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
-- --
--
-- ALTER SEQUENCE public.fg_certificado_id_seq OWNED BY public.fg_certificado.id;
--
--
-- --
-- -- Name: fg_certificado_titular; Type: TABLE; Schema: public; Owner: -
-- --
--
-- CREATE TABLE public.fg_certificado_titular (
--     id bigint NOT NULL,
--     certificado_id bigint NOT NULL,
--     cliente_id bigint,
--     orden smallint NOT NULL,
--     tipo_documento character varying(10),
--     nro_documento character varying(20),
--     nombre_razon_social character varying(300) NOT NULL,
--     direccion character varying(500)
-- );
--
--
-- --
-- -- Name: fg_certificado_titular_id_seq; Type: SEQUENCE; Schema: public; Owner: -
-- --
--
-- CREATE SEQUENCE public.fg_certificado_titular_id_seq
--     START WITH 1
--     INCREMENT BY 1
--     NO MINVALUE
--     NO MAXVALUE
--     CACHE 1;
--
--
-- --
-- -- Name: fg_certificado_titular_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
-- --
--
-- ALTER SEQUENCE public.fg_certificado_titular_id_seq OWNED BY public.fg_certificado_titular.id;
--
--
-- --
-- -- Name: fg_certificado_vehiculo; Type: TABLE; Schema: public; Owner: -
-- --
--
-- CREATE TABLE public.fg_certificado_vehiculo (
--     certificado_id bigint NOT NULL,
--     placa character varying(255),
--     categoria character varying(255),
--     clase character varying(255),
--     marca character varying(255),
--     modelo character varying(255),
--     version character varying(255),
--     anio_fabricacion character varying(10),
--     anio_modelo character varying(10),
--     vin character varying(255),
--     serie_chasis character varying(255),
--     numero_motor character varying(255),
--     combustible character varying(255),
--     color character varying(255),
--     carroceria character varying(255),
--     numero_cilindros character varying(50),
--     cilindrada character varying(50),
--     numero_ejes character varying(50),
--     numero_ruedas character varying(50),
--     numero_asientos character varying(50),
--     numero_pasajeros character varying(50),
--     longitud character varying(50),
--     ancho character varying(50),
--     alto character varying(50),
--     peso_neto character varying(50),
--     peso_bruto character varying(50),
--     carga_util character varying(50),
--     potencia character varying(100),
--     formula_rodante character varying(50)
-- );
--
--
-- --
-- -- Name: fg_chip; Type: TABLE; Schema: public; Owner: -
-- --
--
-- CREATE TABLE public.fg_chip (
--     id bigint NOT NULL,
--     producto_inventariable_id bigint NOT NULL,
--     numero_chip character varying(120) NOT NULL,
--     planta_actual_key character varying NOT NULL,
--     estado character varying(20) DEFAULT 'DISPONIBLE'::character varying NOT NULL,
--     operacion_reserva_id bigint,
--     reservado_en timestamp without time zone,
--     creado_por character varying NOT NULL,
--     creado_en timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
--     actualizado_por character varying,
--     actualizado_en timestamp without time zone,
--     CONSTRAINT ck_fg_chip_estado CHECK (((estado)::text = ANY ((ARRAY['DISPONIBLE'::character varying, 'RESERVADO'::character varying, 'VENDIDO'::character varying, 'BAJA'::character varying])::text[]))),
--     CONSTRAINT ck_fg_chip_numero CHECK ((btrim((numero_chip)::text) <> ''::text)),
--     CONSTRAINT ck_fg_chip_reserva CHECK (((((estado)::text = 'RESERVADO'::text) AND (reservado_en IS NOT NULL)) OR (((estado)::text <> 'RESERVADO'::text) AND (operacion_reserva_id IS NULL) AND (reservado_en IS NULL))))
-- );
--
--
-- --
-- -- Name: fg_chip_id_seq; Type: SEQUENCE; Schema: public; Owner: -
-- --
--
-- ALTER TABLE public.fg_chip ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
--     SEQUENCE NAME public.fg_chip_id_seq
--     START WITH 1
--     INCREMENT BY 1
--     NO MINVALUE
--     NO MAXVALUE
--     CACHE 1
-- );
--
--
-- --
-- -- Name: fg_chip_movimiento; Type: TABLE; Schema: public; Owner: -
-- --
--
-- CREATE TABLE public.fg_chip_movimiento (
--     id bigint NOT NULL,
--     chip_id bigint NOT NULL,
--     tipo_movimiento character varying(20) NOT NULL,
--     planta_origen_key character varying,
--     planta_destino_key character varying,
--     usuario character varying NOT NULL,
--     fecha timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
--     referencia character varying(200),
--     certificado_id bigint,
--     operacion_comercial_id bigint,
--     detalles jsonb DEFAULT '{}'::jsonb NOT NULL,
--     CONSTRAINT ck_fg_chip_movimiento_tipo CHECK (((tipo_movimiento)::text = ANY ((ARRAY['INGRESO'::character varying, 'TRANSFERENCIA'::character varying, 'RESERVA'::character varying, 'LIBERACION'::character varying, 'VENTA'::character varying, 'AJUSTE'::character varying, 'BAJA'::character varying])::text[])))
-- );
--
--
-- --
-- -- Name: fg_chip_movimiento_id_seq; Type: SEQUENCE; Schema: public; Owner: -
-- --
--
-- ALTER TABLE public.fg_chip_movimiento ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
--     SEQUENCE NAME public.fg_chip_movimiento_id_seq
--     START WITH 1
--     INCREMENT BY 1
--     NO MINVALUE
--     NO MAXVALUE
--     CACHE 1
-- );
--
--
-- --
-- -- Name: fg_cliente; Type: TABLE; Schema: public; Owner: -
-- --
--
-- CREATE TABLE public.fg_cliente (
--     id bigint NOT NULL,
--     tipo_documento character varying(10) NOT NULL,
--     nro_documento character varying(20) NOT NULL,
--     nombre_razon_social character varying(300) NOT NULL,
--     direccion character varying(500),
--     telefono character varying(30),
--     correo character varying(200),
--     estado boolean DEFAULT true NOT NULL,
--     fecha_creacion timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
--     fecha_modificacion timestamp without time zone
-- );
--
--
-- --
-- -- Name: fg_cliente_id_seq; Type: SEQUENCE; Schema: public; Owner: -
-- --
--
-- CREATE SEQUENCE public.fg_cliente_id_seq
--     START WITH 1
--     INCREMENT BY 1
--     NO MINVALUE
--     NO MAXVALUE
--     CACHE 1;
--
--
-- --
-- -- Name: fg_cliente_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
-- --
--
-- ALTER SEQUENCE public.fg_cliente_id_seq OWNED BY public.fg_cliente.id;
--
--
-- --
-- -- Name: fg_correlativo_certificado; Type: TABLE; Schema: public; Owner: -
-- --
--
-- CREATE TABLE public.fg_correlativo_certificado (
--     id bigint NOT NULL,
--     tipo_certificado_clave character varying(30) NOT NULL,
--     nro_actual bigint DEFAULT 0 NOT NULL,
--     activo boolean DEFAULT true NOT NULL,
--     fecha_modificacion timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
--     planta_key character varying(20) NOT NULL,
--     nro_inicio bigint NOT NULL,
--     nro_maximo bigint NOT NULL,
--     fecha_asignacion timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
--     fecha_cierre timestamp without time zone,
--     modalidad character varying(20) NOT NULL,
--     CONSTRAINT chk_cierre CHECK (((activo = false) OR (fecha_cierre IS NULL))),
--     CONSTRAINT chk_fg_correlativo_modalidad CHECK (((modalidad)::text = ANY ((ARRAY['INICIAL'::character varying, 'ANUAL'::character varying, 'UNICA'::character varying])::text[]))),
--     CONSTRAINT chk_nro_actual_max CHECK ((nro_actual <= nro_maximo)),
--     CONSTRAINT chk_nro_actual_min CHECK ((nro_actual >= (nro_inicio - 1))),
--     CONSTRAINT chk_nro_inicio CHECK ((nro_inicio > 0)),
--     CONSTRAINT chk_nro_maximo CHECK ((nro_maximo >= nro_inicio))
-- );
--
--
-- --
-- -- Name: TABLE fg_correlativo_certificado; Type: COMMENT; Schema: public; Owner: -
-- --
--
-- COMMENT ON TABLE public.fg_correlativo_certificado IS 'Rangos de numeracion de certificados FAREGAS por sede, tipo y modalidad. Los rangos 100000+ son provisionales de desarrollo.';
--
--
-- --
-- -- Name: COLUMN fg_correlativo_certificado.modalidad; Type: COMMENT; Schema: public; Owner: -
-- --
--
-- COMMENT ON COLUMN public.fg_correlativo_certificado.modalidad IS 'Modalidad exacta del rango: INICIAL, ANUAL o UNICA para Conformidad.';
--
--
-- --
-- -- Name: fg_correlativo_certificado_id_seq; Type: SEQUENCE; Schema: public; Owner: -
-- --
--
-- CREATE SEQUENCE public.fg_correlativo_certificado_id_seq
--     START WITH 1
--     INCREMENT BY 1
--     NO MINVALUE
--     NO MAXVALUE
--     CACHE 1;
--
--
-- --
-- -- Name: fg_correlativo_certificado_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
-- --
--
-- ALTER SEQUENCE public.fg_correlativo_certificado_id_seq OWNED BY public.fg_correlativo_certificado.id;
--
--
-- --
-- -- Name: fg_correlativo_certificado_sede; Type: TABLE; Schema: public; Owner: -
-- --
--
-- CREATE TABLE public.fg_correlativo_certificado_sede (
--     id bigint NOT NULL,
--     planta_key character varying NOT NULL,
--     rango_inicio bigint NOT NULL,
--     rango_fin bigint NOT NULL,
--     numero_actual bigint NOT NULL,
--     cantidad bigint GENERATED ALWAYS AS (((rango_fin - rango_inicio) + 1)) STORED,
--     disponibles bigint GENERATED ALWAYS AS ((rango_fin - numero_actual)) STORED,
--     estado character varying DEFAULT 'ACTIVO'::character varying NOT NULL,
--     fecha_asignacion timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
--     fecha_cierre timestamp without time zone,
--     observacion character varying(500),
--     fecha_creacion timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
--     fecha_modificacion timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
--     CONSTRAINT chk_corr_sede_actual CHECK (((numero_actual >= (rango_inicio - 1)) AND (numero_actual <= rango_fin))),
--     CONSTRAINT chk_corr_sede_agotado_coherente CHECK ((((estado)::text <> 'AGOTADO'::text) OR (numero_actual >= rango_fin))),
--     CONSTRAINT chk_corr_sede_agotado_sin_cierre CHECK ((((estado)::text <> 'AGOTADO'::text) OR (fecha_cierre IS NULL))),
--     CONSTRAINT chk_corr_sede_cantidad CHECK (((((rango_fin - rango_inicio) + 1) >= 1) AND (((rango_fin - rango_inicio) + 1) <= 50))),
--     CONSTRAINT chk_corr_sede_cierre CHECK ((((estado)::text <> 'CERRADO'::text) OR (fecha_cierre IS NOT NULL))),
--     CONSTRAINT chk_corr_sede_desde CHECK ((rango_inicio > 0)),
--     CONSTRAINT chk_corr_sede_estado CHECK (((estado)::text = ANY ((ARRAY['ACTIVO'::character varying, 'AGOTADO'::character varying, 'CERRADO'::character varying])::text[]))),
--     CONSTRAINT chk_corr_sede_hasta CHECK ((rango_fin >= rango_inicio))
-- );
--
--
-- --
-- -- Name: fg_correlativo_certificado_sede_id_seq; Type: SEQUENCE; Schema: public; Owner: -
-- --
--
-- CREATE SEQUENCE public.fg_correlativo_certificado_sede_id_seq
--     START WITH 1
--     INCREMENT BY 1
--     NO MINVALUE
--     NO MAXVALUE
--     CACHE 1;
--
--
-- --
-- -- Name: fg_correlativo_certificado_sede_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
-- --
--
-- ALTER SEQUENCE public.fg_correlativo_certificado_sede_id_seq OWNED BY public.fg_correlativo_certificado_sede.id;
--
--
-- --
-- -- Name: fg_credito; Type: TABLE; Schema: public; Owner: -
-- --
--
-- CREATE TABLE public.fg_credito (
--     id bigint NOT NULL,
--     planta_key character varying NOT NULL,
--     facturacion_id bigint NOT NULL,
--     serie_comprobante_id bigint,
--     motivo_codigo character varying(10),
--     sustento text,
--     serie character varying(30),
--     numero bigint,
--     nro_comprobante character varying(80),
--     moneda_key character varying DEFAULT 'sol'::character varying NOT NULL,
--     base_imponible numeric(14,2) DEFAULT 0 NOT NULL,
--     igv numeric(14,2) DEFAULT 0 NOT NULL,
--     importe_total numeric(14,2) DEFAULT 0 NOT NULL,
--     estado character varying(20) DEFAULT 'BORRADOR'::character varying NOT NULL,
--     proveedor character varying(30) DEFAULT 'NUBEFACT'::character varying NOT NULL,
--     aceptada_sunat boolean,
--     respuesta_proveedor jsonb,
--     usuario_creacion character varying NOT NULL,
--     fecha_creacion timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
--     usuario_modificacion character varying,
--     fecha_modificacion timestamp without time zone,
--     empresa_key character varying,
--     ruc_emisor character varying(11),
--     codigo_unico character varying(20),
--     sunat_description text,
--     sunat_responsecode character varying(50),
--     sunat_soap_error text,
--     enlace_pdf text,
--     enlace_xml text,
--     enlace_cdr text,
--     intentos integer DEFAULT 0 NOT NULL,
--     fecha_ultimo_intento timestamp without time zone,
--     fecha_aceptacion timestamp without time zone,
--     CONSTRAINT ck_fg_credito_estado CHECK (((estado)::text = ANY ((ARRAY['BORRADOR'::character varying, 'PENDIENTE'::character varying, 'ACEPTADO'::character varying, 'RECHAZADO'::character varying, 'ERROR'::character varying, 'ANULADO'::character varying])::text[]))),
--     CONSTRAINT ck_fg_credito_importes CHECK (((base_imponible >= (0)::numeric) AND (igv >= (0)::numeric) AND (importe_total >= (0)::numeric))),
--     CONSTRAINT ck_fg_credito_numero CHECK (((numero IS NULL) OR (numero > 0)))
-- );
--
--
-- --
-- -- Name: fg_credito_id_seq; Type: SEQUENCE; Schema: public; Owner: -
-- --
--
-- CREATE SEQUENCE public.fg_credito_id_seq
--     START WITH 1
--     INCREMENT BY 1
--     NO MINVALUE
--     NO MAXVALUE
--     CACHE 1;
--
--
-- --
-- -- Name: fg_credito_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
-- --
--
-- ALTER SEQUENCE public.fg_credito_id_seq OWNED BY public.fg_credito.id;
--
--
-- --
-- -- Name: fg_debito; Type: TABLE; Schema: public; Owner: -
-- --
--
-- CREATE TABLE public.fg_debito (
--     id bigint NOT NULL,
--     planta_key character varying NOT NULL,
--     facturacion_id bigint NOT NULL,
--     serie_comprobante_id bigint,
--     motivo_codigo character varying(10),
--     sustento text,
--     serie character varying(30),
--     numero bigint,
--     nro_comprobante character varying(80),
--     moneda_key character varying DEFAULT 'sol'::character varying NOT NULL,
--     base_imponible numeric(14,2) DEFAULT 0 NOT NULL,
--     igv numeric(14,2) DEFAULT 0 NOT NULL,
--     importe_total numeric(14,2) DEFAULT 0 NOT NULL,
--     estado character varying(20) DEFAULT 'BORRADOR'::character varying NOT NULL,
--     proveedor character varying(30) DEFAULT 'NUBEFACT'::character varying NOT NULL,
--     aceptada_sunat boolean,
--     respuesta_proveedor jsonb,
--     usuario_creacion character varying NOT NULL,
--     fecha_creacion timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
--     usuario_modificacion character varying,
--     fecha_modificacion timestamp without time zone,
--     empresa_key character varying,
--     ruc_emisor character varying(11),
--     codigo_unico character varying(20),
--     sunat_description text,
--     sunat_responsecode character varying(50),
--     sunat_soap_error text,
--     enlace_pdf text,
--     enlace_xml text,
--     enlace_cdr text,
--     intentos integer DEFAULT 0 NOT NULL,
--     fecha_ultimo_intento timestamp without time zone,
--     fecha_aceptacion timestamp without time zone,
--     CONSTRAINT ck_fg_debito_estado CHECK (((estado)::text = ANY ((ARRAY['BORRADOR'::character varying, 'PENDIENTE'::character varying, 'ACEPTADO'::character varying, 'RECHAZADO'::character varying, 'ERROR'::character varying, 'ANULADO'::character varying])::text[]))),
--     CONSTRAINT ck_fg_debito_importes CHECK (((base_imponible >= (0)::numeric) AND (igv >= (0)::numeric) AND (importe_total >= (0)::numeric))),
--     CONSTRAINT ck_fg_debito_numero CHECK (((numero IS NULL) OR (numero > 0)))
-- );
--
--
-- --
-- -- Name: fg_debito_id_seq; Type: SEQUENCE; Schema: public; Owner: -
-- --
--
-- CREATE SEQUENCE public.fg_debito_id_seq
--     START WITH 1
--     INCREMENT BY 1
--     NO MINVALUE
--     NO MAXVALUE
--     CACHE 1;
--
--
-- --
-- -- Name: fg_debito_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
-- --
--
-- ALTER SEQUENCE public.fg_debito_id_seq OWNED BY public.fg_debito.id;
--
--
-- --
-- -- Name: fg_descuento; Type: TABLE; Schema: public; Owner: -
-- --
--
-- CREATE TABLE public.fg_descuento (
--     id bigint NOT NULL,
--     codigo character varying NOT NULL,
--     nombre character varying NOT NULL,
--     tipo character varying NOT NULL,
--     empresa_aliada_ruc character varying,
--     empresa_aliada_nombre character varying,
--     tipo_calculo character varying,
--     valor numeric(14,2),
--     fecha_inicio timestamp without time zone NOT NULL,
--     fecha_fin timestamp without time zone NOT NULL,
--     planta_key character varying,
--     activo boolean DEFAULT true NOT NULL,
--     usuario_creacion character varying NOT NULL,
--     fecha_creacion timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
--     usuario_modificacion character varying,
--     fecha_modificacion timestamp without time zone,
--     ejecutivo character varying(150),
--     ejecutivo_id bigint,
--     CONSTRAINT chk_fg_descuento_fechas CHECK ((fecha_fin >= fecha_inicio)),
--     CONSTRAINT chk_fg_descuento_porcentaje CHECK ((((tipo_calculo)::text = 'MONTO'::text) OR (((tipo_calculo)::text = 'PORCENTAJE'::text) AND (valor <= (100)::numeric)))),
--     CONSTRAINT chk_fg_descuento_tipo CHECK (((tipo)::text = ANY ((ARRAY['CAMPANA'::character varying, 'ALIANZA'::character varying, 'CONVENIO'::character varying, 'PROMOCION'::character varying])::text[]))),
--     CONSTRAINT chk_fg_descuento_tipo_calculo CHECK (((tipo_calculo)::text = ANY ((ARRAY['MONTO'::character varying, 'PORCENTAJE'::character varying])::text[]))),
--     CONSTRAINT chk_fg_descuento_valor CHECK ((valor > (0)::numeric))
-- );
--
--
-- --
-- -- Name: COLUMN fg_descuento.tipo; Type: COMMENT; Schema: public; Owner: -
-- --
--
-- COMMENT ON COLUMN public.fg_descuento.tipo IS 'Tipo de campaña FAREGAS: CAMPANA, ALIANZA, CONVENIO o PROMOCION';
--
--
-- --
-- -- Name: COLUMN fg_descuento.ejecutivo; Type: COMMENT; Schema: public; Owner: -
-- --
--
-- COMMENT ON COLUMN public.fg_descuento.ejecutivo IS 'Nombre histórico del ejecutivo al momento de registrar el descuento';
--
--
-- --
-- -- Name: COLUMN fg_descuento.ejecutivo_id; Type: COMMENT; Schema: public; Owner: -
-- --
--
-- COMMENT ON COLUMN public.fg_descuento.ejecutivo_id IS 'Ejecutivo FAREGAS relacionado con la alianza';
--
--
-- --
-- -- Name: fg_descuento_id_seq; Type: SEQUENCE; Schema: public; Owner: -
-- --
--
-- CREATE SEQUENCE public.fg_descuento_id_seq
--     START WITH 1
--     INCREMENT BY 1
--     NO MINVALUE
--     NO MAXVALUE
--     CACHE 1;
--
--
-- --
-- -- Name: fg_descuento_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
-- --
--
-- ALTER SEQUENCE public.fg_descuento_id_seq OWNED BY public.fg_descuento.id;
--
--
-- --
-- -- Name: fg_descuentocliente; Type: TABLE; Schema: public; Owner: -
-- --
--
-- CREATE TABLE public.fg_descuentocliente (
--     id bigint NOT NULL,
--     descuento_id bigint NOT NULL,
--     codigo character varying NOT NULL,
--     tipo_documento character varying,
--     nro_documento character varying,
--     placa character varying,
--     fecha_inicio timestamp without time zone,
--     fecha_fin timestamp without time zone,
--     max_usos integer DEFAULT 1 NOT NULL,
--     usos_realizados integer DEFAULT 0 NOT NULL,
--     activo boolean DEFAULT true NOT NULL,
--     usuario_creacion character varying NOT NULL,
--     fecha_creacion timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
--     usuario_modificacion character varying,
--     fecha_modificacion timestamp without time zone,
--     planta_key character varying,
--     tipo_calculo character varying,
--     valor_contado numeric(14,2),
--     valor_credito numeric(14,2),
--     CONSTRAINT chk_fg_descuentocliente_fechas CHECK ((((fecha_inicio IS NULL) AND (fecha_fin IS NULL)) OR (fecha_fin >= fecha_inicio))),
--     CONSTRAINT chk_fg_descuentocliente_tipo_calculo CHECK (((tipo_calculo IS NULL) OR ((tipo_calculo)::text = ANY ((ARRAY['FLAT'::character varying, 'MONTO'::character varying, 'PORCENTAJE'::character varying])::text[])))),
--     CONSTRAINT chk_fg_descuentocliente_tipo_doc CHECK (((tipo_documento IS NULL) OR ((tipo_documento)::text = ANY ((ARRAY['DNI'::character varying, 'RUC'::character varying])::text[])))),
--     CONSTRAINT chk_fg_descuentocliente_usos CHECK (((max_usos > 0) AND (usos_realizados >= 0) AND (usos_realizados <= max_usos))),
--     CONSTRAINT chk_fg_descuentocliente_valores CHECK ((((valor_contado IS NULL) OR (valor_contado > (0)::numeric)) AND ((valor_credito IS NULL) OR (valor_credito > (0)::numeric)) AND (((tipo_calculo)::text <> 'PORCENTAJE'::text) OR (((valor_contado IS NULL) OR (valor_contado <= (100)::numeric)) AND ((valor_credito IS NULL) OR (valor_credito <= (100)::numeric))))))
-- );
--
--
-- --
-- -- Name: fg_descuentocliente_id_seq; Type: SEQUENCE; Schema: public; Owner: -
-- --
--
-- CREATE SEQUENCE public.fg_descuentocliente_id_seq
--     START WITH 1
--     INCREMENT BY 1
--     NO MINVALUE
--     NO MAXVALUE
--     CACHE 1;
--
--
-- --
-- -- Name: fg_descuentocliente_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
-- --
--
-- ALTER SEQUENCE public.fg_descuentocliente_id_seq OWNED BY public.fg_descuentocliente.id;
--
--
-- --
-- -- Name: fg_descuentocomprobante; Type: TABLE; Schema: public; Owner: -
-- --
--
-- CREATE TABLE public.fg_descuentocomprobante (
--     id bigint NOT NULL,
--     descuento_cliente_id bigint,
--     descuento_id bigint,
--     certificado_id bigint NOT NULL,
--     orden_pago_id bigint,
--     facturacion_id bigint,
--     importe_original numeric(14,2) NOT NULL,
--     importe_descuento numeric(14,2) NOT NULL,
--     importe_final numeric(14,2) NOT NULL,
--     estado character varying NOT NULL,
--     reservado_hasta timestamp without time zone NOT NULL,
--     fecha_aplicacion timestamp without time zone,
--     usuario_creacion character varying NOT NULL,
--     fecha_creacion timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
--     usuario_modificacion character varying,
--     fecha_modificacion timestamp without time zone,
--     CONSTRAINT chk_fg_descom_estado CHECK (((estado)::text = ANY ((ARRAY['RESERVADO'::character varying, 'APLICADO'::character varying, 'LIBERADO'::character varying, 'ANULADO'::character varying])::text[]))),
--     CONSTRAINT chk_fg_descom_importes CHECK (((importe_original >= importe_descuento) AND (importe_final = (importe_original - importe_descuento)) AND (importe_final >= (0)::numeric))),
--     CONSTRAINT chk_fg_descom_descuento_ref CHECK (((descuento_id IS NOT NULL) OR (descuento_cliente_id IS NOT NULL))),
--     CONSTRAINT fk_fg_descom_descuento FOREIGN KEY (descuento_id) REFERENCES public.fg_descuento(id) ON UPDATE CASCADE ON DELETE RESTRICT
-- );
--
--
-- --
-- -- Name: fg_descuentocomprobante_id_seq; Type: SEQUENCE; Schema: public; Owner: -
-- --
--
-- CREATE SEQUENCE public.fg_descuentocomprobante_id_seq
--     START WITH 1
--     INCREMENT BY 1
--     NO MINVALUE
--     NO MAXVALUE
--     CACHE 1;
--
--
-- --
-- -- Name: fg_descuentocomprobante_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
-- --
--
-- ALTER SEQUENCE public.fg_descuentocomprobante_id_seq OWNED BY public.fg_descuentocomprobante.id;
--
--
-- --
-- -- Name: fg_descuentodetalle; Type: TABLE; Schema: public; Owner: -
-- --
--
-- CREATE TABLE public.fg_descuentodetalle (
--     id bigint NOT NULL,
--     descuento_id bigint NOT NULL,
--     servicio_id integer NOT NULL,
--     tipo_calculo character varying,
--     valor numeric(14,2),
--     precio_minimo numeric(14,2),
--     activo boolean DEFAULT true NOT NULL,
--     usuario_creacion character varying NOT NULL,
--     fecha_creacion timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
--     usuario_modificacion character varying,
--     fecha_modificacion timestamp without time zone,
--     descuento_cliente_id bigint,
--     planta_key character varying,
--     valor_contado numeric(14,2),
--     valor_credito numeric(14,2),
--     CONSTRAINT chk_fg_descuentodetalle_precio_min CHECK (((precio_minimo IS NULL) OR (precio_minimo >= (0)::numeric))),
--     CONSTRAINT chk_fg_descuentodetalle_regla_compartida CHECK (((descuento_cliente_id IS NOT NULL) OR ((planta_key IS NOT NULL) AND ((tipo_calculo)::text = ANY ((ARRAY['FLAT'::character varying, 'MONTO'::character varying, 'PORCENTAJE'::character varying])::text[])) AND ((((tipo_calculo)::text = 'FLAT'::text) AND (valor IS NULL) AND ((valor_contado IS NOT NULL) OR (valor_credito IS NOT NULL)) AND ((valor_contado IS NULL) OR (valor_contado > (0)::numeric)) AND ((valor_credito IS NULL) OR (valor_credito > (0)::numeric))) OR (((tipo_calculo)::text = 'MONTO'::text) AND (valor > (0)::numeric) AND (valor_contado IS NULL) AND (valor_credito IS NULL)) OR (((tipo_calculo)::text = 'PORCENTAJE'::text) AND (valor > (0)::numeric) AND (valor <= (100)::numeric) AND (valor_contado IS NULL) AND (valor_credito IS NULL)))))),
--     CONSTRAINT chk_fg_descuentodetalle_valor CHECK (((valor IS NULL) OR (valor > (0)::numeric)))
-- );
--
--
-- --
-- -- Name: fg_descuentodetalle_id_seq; Type: SEQUENCE; Schema: public; Owner: -
-- --
--
-- CREATE SEQUENCE public.fg_descuentodetalle_id_seq
--     START WITH 1
--     INCREMENT BY 1
--     NO MINVALUE
--     NO MAXVALUE
--     CACHE 1;
--
--
-- --
-- -- Name: fg_descuentodetalle_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
-- --
--
-- ALTER SEQUENCE public.fg_descuentodetalle_id_seq OWNED BY public.fg_descuentodetalle.id;
--
--
-- --
-- -- Name: fg_documento_anulacion; Type: TABLE; Schema: public; Owner: -
-- --
--
-- CREATE TABLE public.fg_documento_anulacion (
--     id bigint NOT NULL,
--     facturacion_id bigint,
--     credito_id bigint,
--     debito_id bigint,
--     motivo character varying(100) NOT NULL,
--     codigo_unico character varying(20) NOT NULL,
--     estado character varying(20) DEFAULT 'BORRADOR'::character varying NOT NULL,
--     ticket_sunat character varying(250),
--     aceptada_sunat boolean,
--     sunat_description text,
--     sunat_responsecode character varying(50),
--     sunat_soap_error text,
--     enlace_pdf text,
--     enlace_xml text,
--     enlace_cdr text,
--     respuesta_proveedor jsonb,
--     intentos integer DEFAULT 0 NOT NULL,
--     fecha_ultimo_intento timestamp without time zone,
--     fecha_aceptacion timestamp without time zone,
--     usuario_creacion character varying(255) NOT NULL,
--     fecha_creacion timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
--     usuario_modificacion character varying(255),
--     fecha_modificacion timestamp without time zone,
--     CONSTRAINT ck_fg_anulacion_codigo CHECK (((btrim((codigo_unico)::text) <> ''::text) AND (char_length((codigo_unico)::text) <= 20))),
--     CONSTRAINT ck_fg_anulacion_documento CHECK ((num_nonnulls(facturacion_id, credito_id, debito_id) = 1)),
--     CONSTRAINT ck_fg_anulacion_estado CHECK (((estado)::text = ANY ((ARRAY['BORRADOR'::character varying, 'PENDIENTE'::character varying, 'ACEPTADO'::character varying, 'RECHAZADO'::character varying, 'ERROR'::character varying])::text[]))),
--     CONSTRAINT ck_fg_anulacion_motivo CHECK ((btrim((motivo)::text) <> ''::text))
-- );
--
--
-- --
-- -- Name: fg_documento_anulacion_id_seq; Type: SEQUENCE; Schema: public; Owner: -
-- --
--
-- ALTER TABLE public.fg_documento_anulacion ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
--     SEQUENCE NAME public.fg_documento_anulacion_id_seq
--     START WITH 1
--     INCREMENT BY 1
--     NO MINVALUE
--     NO MAXVALUE
--     CACHE 1
-- );
--
--
-- --
-- -- Name: fg_documento_electronico_operacion; Type: TABLE; Schema: public; Owner: -
-- --
--
-- CREATE TABLE public.fg_documento_electronico_operacion (
--     id bigint NOT NULL,
--     facturacion_id bigint,
--     credito_id bigint,
--     debito_id bigint,
--     anulacion_id bigint,
--     operacion character varying(30) NOT NULL,
--     numero_intento integer NOT NULL,
--     estado character varying(20) NOT NULL,
--     solicitud jsonb NOT NULL,
--     respuesta jsonb,
--     http_status integer,
--     error text,
--     usuario_creacion character varying(255) NOT NULL,
--     fecha_creacion timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
--     fecha_finalizacion timestamp without time zone,
--     CONSTRAINT ck_fg_doc_operacion_documento CHECK ((num_nonnulls(facturacion_id, credito_id, debito_id, anulacion_id) = 1)),
--     CONSTRAINT ck_fg_doc_operacion_estado CHECK (((estado)::text = ANY ((ARRAY['PENDIENTE'::character varying, 'ACEPTADO'::character varying, 'PROCESANDO'::character varying, 'RECHAZADO'::character varying, 'ERROR'::character varying])::text[]))),
--     CONSTRAINT ck_fg_doc_operacion_intento CHECK ((numero_intento > 0)),
--     CONSTRAINT ck_fg_doc_operacion_tipo CHECK (((operacion)::text = ANY ((ARRAY['EMITIR'::character varying, 'CONSULTAR'::character varying, 'ANULAR'::character varying, 'CONSULTAR_ANULACION'::character varying])::text[])))
-- );
--
--
-- --
-- -- Name: fg_documento_electronico_operacion_id_seq; Type: SEQUENCE; Schema: public; Owner: -
-- --
--
-- ALTER TABLE public.fg_documento_electronico_operacion ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
--     SEQUENCE NAME public.fg_documento_electronico_operacion_id_seq
--     START WITH 1
--     INCREMENT BY 1
--     NO MINVALUE
--     NO MAXVALUE
--     CACHE 1
-- );
--
--
-- --
-- -- Name: fg_ejecutivo; Type: TABLE; Schema: public; Owner: -
-- --
--
-- CREATE TABLE public.fg_ejecutivo (
--     id bigint NOT NULL,
--     username character varying(255),
--     nombre character varying(200) NOT NULL,
--     activo boolean DEFAULT true NOT NULL,
--     usuario_creacion character varying(255) NOT NULL,
--     fecha_creacion timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
--     usuario_modificacion character varying(255),
--     fecha_modificacion timestamp without time zone,
--     CONSTRAINT ck_fg_ejecutivo_nombre CHECK ((btrim((nombre)::text) <> ''::text))
-- );
--
--
-- --
-- -- Name: TABLE fg_ejecutivo; Type: COMMENT; Schema: public; Owner: -
-- --
--
-- COMMENT ON TABLE public.fg_ejecutivo IS 'Catálogo de colaboradores responsables de alianzas FAREGAS';
--
--
-- --
-- -- Name: fg_ejecutivo_id_seq; Type: SEQUENCE; Schema: public; Owner: -
-- --
--
-- CREATE SEQUENCE public.fg_ejecutivo_id_seq
--     START WITH 1
--     INCREMENT BY 1
--     NO MINVALUE
--     NO MAXVALUE
--     CACHE 1;
--
--
-- --
-- -- Name: fg_ejecutivo_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
-- --
--
-- ALTER SEQUENCE public.fg_ejecutivo_id_seq OWNED BY public.fg_ejecutivo.id;
--
--
-- --
-- -- Name: fg_empresa; Type: TABLE; Schema: public; Owner: -
-- --
--
-- CREATE TABLE public.fg_empresa (
--     key character varying NOT NULL,
--     nombre character varying NOT NULL,
--     ruc character varying,
--     direccion character varying,
--     telefono character varying,
--     cuenta_banco_nacion character varying,
--     activo boolean DEFAULT true NOT NULL,
--     fecha_creacion timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
--     fecha_modificacion timestamp without time zone,
--     CONSTRAINT chk_fg_empresa_key CHECK ((btrim((key)::text) <> ''::text)),
--     CONSTRAINT chk_fg_empresa_nombre CHECK ((btrim((nombre)::text) <> ''::text)),
--     CONSTRAINT chk_fg_empresa_ruc CHECK (((ruc IS NULL) OR ((ruc)::text ~ '^[0-9]{11}$'::text)))
-- );
--
--
-- --
-- -- Name: fg_empresa_facturador; Type: TABLE; Schema: public; Owner: -
-- --
--
-- CREATE TABLE public.fg_empresa_facturador (
--     id bigint NOT NULL,
--     empresa_key character varying NOT NULL,
--     proveedor character varying(30) DEFAULT 'NUBEFACT'::character varying NOT NULL,
--     entorno character varying(20) DEFAULT 'DEMO'::character varying NOT NULL,
--     credencial_clave character varying(80) NOT NULL,
--     activo boolean DEFAULT true NOT NULL,
--     fecha_creacion timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
--     fecha_modificacion timestamp without time zone,
--     CONSTRAINT ck_fg_empresa_facturador_credencial CHECK (((credencial_clave)::text ~ '^[A-Z0-9_]+$'::text)),
--     CONSTRAINT ck_fg_empresa_facturador_entorno CHECK (((entorno)::text = ANY ((ARRAY['DEMO'::character varying, 'PRODUCCION'::character varying])::text[]))),
--     CONSTRAINT ck_fg_empresa_facturador_proveedor CHECK (((proveedor)::text = 'NUBEFACT'::text))
-- );
--
--
-- --
-- -- Name: COLUMN fg_empresa_facturador.credencial_clave; Type: COMMENT; Schema: public; Owner: -
-- --
--
-- COMMENT ON COLUMN public.fg_empresa_facturador.credencial_clave IS 'Identificador de variables de entorno; nunca contiene ruta ni token.';
--
--
-- --
-- -- Name: fg_empresa_facturador_id_seq; Type: SEQUENCE; Schema: public; Owner: -
-- --
--
-- ALTER TABLE public.fg_empresa_facturador ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
--     SEQUENCE NAME public.fg_empresa_facturador_id_seq
--     START WITH 1
--     INCREMENT BY 1
--     NO MINVALUE
--     NO MAXVALUE
--     CACHE 1
-- );
--
--
-- --
-- -- Name: fg_facturacion; Type: TABLE; Schema: public; Owner: -
-- --
--
-- CREATE TABLE public.fg_facturacion (
--     id bigint NOT NULL,
--     certificado_id bigint,
--     tipo_comprobante character varying(10) NOT NULL,
--     tipo_documento_cliente character varying(20) NOT NULL,
--     nro_documento character varying(20) NOT NULL,
--     nombre_razon_social character varying(250) NOT NULL,
--     direccion character varying(500) NOT NULL,
--     email character varying(150),
--     telefono character varying(30),
--     moneda_key character varying(20) DEFAULT 'sol'::character varying NOT NULL,
--     base_imponible numeric(14,2) NOT NULL,
--     igv numeric(14,2) NOT NULL,
--     importe_total numeric(14,2) NOT NULL,
--     estado character varying(20) DEFAULT 'BORRADOR'::character varying NOT NULL,
--     serie character varying(20),
--     numero bigint,
--     nro_comprobante character varying(50),
--     proveedor character varying(30) DEFAULT 'NUBEFACT'::character varying NOT NULL,
--     aceptada_sunat boolean,
--     sunat_description text,
--     sunat_responsecode character varying(50),
--     sunat_soap_error text,
--     enlace_pdf text,
--     enlace_xml text,
--     enlace_cdr text,
--     cadena_qr text,
--     codigo_hash text,
--     respuesta_proveedor jsonb,
--     intentos integer DEFAULT 0 NOT NULL,
--     fecha_ultimo_intento timestamp without time zone,
--     fecha_aceptacion timestamp without time zone,
--     usuario_creacion character varying(255) NOT NULL,
--     fecha_creacion timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
--     usuario_modificacion character varying(255),
--     fecha_modificacion timestamp without time zone,
--     operacion_id bigint,
--     planta_key character varying,
--     empresa_key character varying,
--     ruc_emisor character varying(11),
--     razon_social_emisor character varying(250),
--     direccion_emisor character varying(500),
--     entorno_facturador character varying(20),
--     codigo_unico character varying(20),
--     condicion_pago character varying(10) DEFAULT 'CONTADO'::character varying NOT NULL,
--     fecha_vencimiento date,
--     medio_pago character varying(250),
--     serie_comprobante_id bigint,
--     fecha_reserva_correlativo timestamp without time zone,
--     venta_id bigint,
--     fecha_documento date,
--     fecha_hora_emision timestamptz,
--     sede_nombre_snapshot character varying(150),
--     sede_direccion_snapshot character varying(500),
--     sede_telefono_snapshot character varying(255),
--     sede_correo_snapshot character varying(255),
--     codigo_descuento_snapshot character varying(120),
--     enlace_pdf_faregas text,
--     facturar_al_dueno_principal boolean,
--     CONSTRAINT ck_fg_facturacion_codigo_unico CHECK (((codigo_unico IS NULL) OR ((btrim((codigo_unico)::text) <> ''::text) AND (char_length((codigo_unico)::text) <= 20)))),
--     CONSTRAINT ck_fg_facturacion_condicion_pago CHECK (((condicion_pago)::text = ANY ((ARRAY['CONTADO'::character varying, 'CREDITO'::character varying])::text[]))),
--     CONSTRAINT ck_fg_facturacion_documento CHECK (((tipo_documento_cliente)::text = ANY ((ARRAY['DNI'::character varying, 'RUC'::character varying, 'CARNETEXTRANJERIA'::character varying])::text[]))),
--     CONSTRAINT ck_fg_facturacion_entorno CHECK (((entorno_facturador IS NULL) OR ((entorno_facturador)::text = ANY ((ARRAY['DEMO'::character varying, 'PRODUCCION'::character varying])::text[])))),
--     CONSTRAINT ck_fg_facturacion_importes CHECK (((base_imponible >= (0)::numeric) AND (igv >= (0)::numeric) AND (importe_total >= (0)::numeric))),
--     CONSTRAINT ck_fg_facturacion_ruc_emisor CHECK (((ruc_emisor IS NULL) OR ((ruc_emisor)::text ~ '^[0-9]{11}$'::text))),
--     CONSTRAINT ck_fg_facturacion_tipo CHECK (((tipo_comprobante)::text = ANY ((ARRAY['BOLETA'::character varying, 'FACTURA'::character varying])::text[]))),
--     CONSTRAINT fg_facturacion_estado_check CHECK (((estado)::text = ANY ((ARRAY['BORRADOR'::character varying, 'PENDIENTE'::character varying, 'PENDIENTE_SUNAT'::character varying, 'ACEPTADO'::character varying, 'RECHAZADO'::character varying, 'ERROR'::character varying, 'ANULADO'::character varying])::text[])))
-- );
--
--
-- --
-- -- Name: COLUMN fg_facturacion.codigo_unico; Type: COMMENT; Schema: public; Owner: -
-- --
--
-- COMMENT ON COLUMN public.fg_facturacion.codigo_unico IS 'Idempotencia Nubefact estable para todos los reintentos de una facturacion.';
--
--
-- --
-- -- Name: fg_facturacion_cuota; Type: TABLE; Schema: public; Owner: -
-- --
--
-- CREATE TABLE public.fg_facturacion_cuota (
--     id bigint NOT NULL,
--     facturacion_id bigint NOT NULL,
--     numero_cuota integer NOT NULL,
--     fecha_pago date NOT NULL,
--     importe numeric(14,2) NOT NULL,
--     estado character varying(20) DEFAULT 'PENDIENTE'::character varying NOT NULL,
--     fecha_creacion timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
--     fecha_modificacion timestamp without time zone,
--     CONSTRAINT ck_fg_facturacion_cuota_estado CHECK (((estado)::text = ANY ((ARRAY['PENDIENTE'::character varying, 'PAGADA'::character varying, 'ANULADA'::character varying])::text[]))),
--     CONSTRAINT ck_fg_facturacion_cuota_importe CHECK ((importe > (0)::numeric)),
--     CONSTRAINT ck_fg_facturacion_cuota_numero CHECK ((numero_cuota > 0))
-- );
--
--
-- --
-- -- Name: fg_facturacion_cuota_id_seq; Type: SEQUENCE; Schema: public; Owner: -
-- --
--
-- ALTER TABLE public.fg_facturacion_cuota ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
--     SEQUENCE NAME public.fg_facturacion_cuota_id_seq
--     START WITH 1
--     INCREMENT BY 1
--     NO MINVALUE
--     NO MAXVALUE
--     CACHE 1
-- );
--
--
-- --
-- -- Name: fg_facturacion_id_seq; Type: SEQUENCE; Schema: public; Owner: -
-- --
--
-- ALTER TABLE public.fg_facturacion ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
--     SEQUENCE NAME public.fg_facturacion_id_seq
--     START WITH 1
--     INCREMENT BY 1
--     NO MINVALUE
--     NO MAXVALUE
--     CACHE 1
-- );
--
--
-- --
-- -- Name: fg_facturacion_intento; Type: TABLE; Schema: public; Owner: -
-- --
--
-- CREATE TABLE public.fg_facturacion_intento (
--     id bigint NOT NULL,
--     facturacion_id bigint NOT NULL,
--     numero_intento integer NOT NULL,
--     estado character varying(20) NOT NULL,
--     solicitud jsonb NOT NULL,
--     respuesta jsonb,
--     http_status integer,
--     error text,
--     fecha_creacion timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
--     fecha_finalizacion timestamp without time zone,
--     CONSTRAINT ck_fg_facturacion_intento_estado CHECK (((estado)::text = ANY (ARRAY[('PENDIENTE'::character varying)::text, ('ACEPTADO'::character varying)::text, ('RECHAZADO'::character varying)::text, ('ERROR'::character varying)::text, ('PENDIENTE_SUNAT'::character varying)::text])))
-- );
--
--
-- --
-- -- Name: fg_facturacion_intento_id_seq; Type: SEQUENCE; Schema: public; Owner: -
-- --
--
-- ALTER TABLE public.fg_facturacion_intento ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
--     SEQUENCE NAME public.fg_facturacion_intento_id_seq
--     START WITH 1
--     INCREMENT BY 1
--     NO MINVALUE
--     NO MAXVALUE
--     CACHE 1
-- );
--
--
-- --
-- -- Name: fg_inventario_cantidad_movimiento; Type: TABLE; Schema: public; Owner: -
-- --
--
-- CREATE TABLE public.fg_inventario_cantidad_movimiento (
--     id bigint NOT NULL,
--     producto_inventariable_id bigint NOT NULL,
--     planta_key character varying NOT NULL,
--     tipo_movimiento character varying(20) NOT NULL,
--     sentido character varying(10) NOT NULL,
--     cantidad numeric(12,3) NOT NULL,
--     operacion_detalle_id bigint,
--     usuario character varying NOT NULL,
--     referencia character varying(250),
--     detalles jsonb DEFAULT '{}'::jsonb NOT NULL,
--     fecha_creacion timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
--     CONSTRAINT fg_inventario_cantidad_movimiento_cantidad_check CHECK ((cantidad > (0)::numeric)),
--     CONSTRAINT fg_inventario_cantidad_movimiento_sentido_check CHECK (((sentido)::text = ANY ((ARRAY['ENTRADA'::character varying, 'SALIDA'::character varying])::text[]))),
--     CONSTRAINT fg_inventario_cantidad_movimiento_tipo_movimiento_check CHECK (((tipo_movimiento)::text = ANY ((ARRAY['INGRESO'::character varying, 'VENTA'::character varying, 'AJUSTE'::character varying, 'DEVOLUCION'::character varying])::text[]))),
--     CONSTRAINT fg_inventario_cantidad_movimiento_tipo_sentido_ck CHECK (((((tipo_movimiento)::text = ANY ((ARRAY['INGRESO'::character varying, 'DEVOLUCION'::character varying])::text[])) AND ((sentido)::text = 'ENTRADA'::text)) OR (((tipo_movimiento)::text = 'VENTA'::text) AND ((sentido)::text = 'SALIDA'::text)) OR ((tipo_movimiento)::text = 'AJUSTE'::text)))
-- );
--
--
-- --
-- -- Name: fg_inventario_cantidad_movimiento_id_seq; Type: SEQUENCE; Schema: public; Owner: -
-- --
--
-- ALTER TABLE public.fg_inventario_cantidad_movimiento ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
--     SEQUENCE NAME public.fg_inventario_cantidad_movimiento_id_seq
--     START WITH 1
--     INCREMENT BY 1
--     NO MINVALUE
--     NO MAXVALUE
--     CACHE 1
-- );
--
--
-- --
-- -- Name: fg_operacion_comercial; Type: TABLE; Schema: public; Owner: -
-- --
--
-- CREATE TABLE public.fg_operacion_comercial (
--     id bigint NOT NULL,
--     planta_key character varying NOT NULL,
--     cliente_id bigint,
--     tipo_documento_cliente_snapshot character varying(20),
--     documento_cliente_snapshot character varying(20),
--     nombre_cliente_snapshot character varying(250),
--     direccion_cliente_snapshot character varying(500),
--     placa character varying(12),
--     moneda_key character varying DEFAULT 'sol'::character varying NOT NULL,
--     base_imponible numeric(14,2) DEFAULT 0 NOT NULL,
--     igv numeric(14,2) DEFAULT 0 NOT NULL,
--     importe_total numeric(14,2) DEFAULT 0 NOT NULL,
--     estado character varying(30) DEFAULT 'BORRADOR'::character varying NOT NULL,
--     usuario_creacion character varying NOT NULL,
--     fecha_creacion timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
--     usuario_modificacion character varying,
--     fecha_modificacion timestamp without time zone,
--     CONSTRAINT ck_fg_operacion_estado CHECK (((estado)::text = ANY ((ARRAY['BORRADOR'::character varying, 'PENDIENTE_PAGO'::character varying, 'PAGADO'::character varying, 'FACTURADO'::character varying, 'ANULADO'::character varying])::text[]))),
--     CONSTRAINT ck_fg_operacion_importes CHECK (((base_imponible >= (0)::numeric) AND (igv >= (0)::numeric) AND (importe_total >= (0)::numeric))),
--     CONSTRAINT ck_fg_operacion_placa CHECK (((placa IS NULL) OR (btrim((placa)::text) <> ''::text)))
-- );
--
--
-- --
-- -- Name: fg_operacion_comercial_id_seq; Type: SEQUENCE; Schema: public; Owner: -
-- --
--
-- CREATE SEQUENCE public.fg_operacion_comercial_id_seq
--     START WITH 1
--     INCREMENT BY 1
--     NO MINVALUE
--     NO MAXVALUE
--     CACHE 1;
--
--
-- --
-- -- Name: fg_operacion_comercial_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
-- --
--
-- ALTER SEQUENCE public.fg_operacion_comercial_id_seq OWNED BY public.fg_operacion_comercial.id;
--
--
-- --
-- -- Name: fg_operacion_detalle; Type: TABLE; Schema: public; Owner: -
-- --
--
-- CREATE TABLE public.fg_operacion_detalle (
--     id bigint NOT NULL,
--     operacion_id bigint NOT NULL,
--     tipo_item character varying(20) NOT NULL,
--     servicio_id integer,
--     tarifa_id integer,
--     producto_facturacion_id bigint,
--     certificado_id bigint,
--     cantidad numeric(12,3) NOT NULL,
--     codigo_sku_snapshot character varying(80),
--     descripcion_snapshot character varying(500) NOT NULL,
--     unidad_snapshot character varying(30) NOT NULL,
--     afectacion_igv_snapshot character varying(2) NOT NULL,
--     codigo_sunat_snapshot character varying(30),
--     valor_unitario numeric(14,6) NOT NULL,
--     precio_unitario numeric(14,6) NOT NULL,
--     base_imponible numeric(14,2) NOT NULL,
--     igv numeric(14,2) NOT NULL,
--     importe_total numeric(14,2) NOT NULL,
--     genera_certificado_snapshot boolean DEFAULT false NOT NULL,
--     orden integer NOT NULL,
--     fecha_creacion timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
--     CONSTRAINT ck_fg_operacion_detalle_cantidad CHECK ((cantidad > (0)::numeric)),
--     CONSTRAINT ck_fg_operacion_detalle_concepto CHECK (((((tipo_item)::text = 'PRODUCTO'::text) AND (servicio_id IS NULL) AND (tarifa_id IS NULL) AND (certificado_id IS NULL) AND (genera_certificado_snapshot = false) AND ((producto_facturacion_id IS NOT NULL) OR ((producto_facturacion_id IS NULL) AND (codigo_sku_snapshot IS NOT NULL) AND (descripcion_snapshot IS NOT NULL) AND (unidad_snapshot IS NOT NULL) AND (afectacion_igv_snapshot IS NOT NULL) AND (valor_unitario IS NOT NULL) AND (precio_unitario IS NOT NULL) AND (base_imponible IS NOT NULL) AND (igv IS NOT NULL) AND (importe_total IS NOT NULL)))) OR (((tipo_item)::text = 'SERVICIO'::text) AND (servicio_id IS NOT NULL) AND ((tarifa_id IS NOT NULL) OR ((tarifa_id IS NULL) AND (codigo_sku_snapshot IS NOT NULL) AND (descripcion_snapshot IS NOT NULL) AND (unidad_snapshot IS NOT NULL) AND (afectacion_igv_snapshot IS NOT NULL) AND (valor_unitario IS NOT NULL) AND (precio_unitario IS NOT NULL) AND (base_imponible IS NOT NULL) AND (igv IS NOT NULL) AND (importe_total IS NOT NULL))) AND (((genera_certificado_snapshot = true) AND (certificado_id IS NOT NULL)) OR ((genera_certificado_snapshot = false) AND (certificado_id IS NULL)))))),
--     CONSTRAINT ck_fg_operacion_detalle_importes CHECK (((valor_unitario >= (0)::numeric) AND (precio_unitario >= (0)::numeric) AND (base_imponible >= (0)::numeric) AND (igv >= (0)::numeric) AND (importe_total >= (0)::numeric))),
--     CONSTRAINT ck_fg_operacion_detalle_orden CHECK ((orden > 0)),
--     CONSTRAINT ck_fg_operacion_detalle_tipo CHECK (((tipo_item)::text = ANY ((ARRAY['SERVICIO'::character varying, 'PRODUCTO'::character varying])::text[])))
-- );
--
--
-- --
-- -- Name: fg_operacion_detalle_chip; Type: TABLE; Schema: public; Owner: -
-- --
--
-- CREATE TABLE public.fg_operacion_detalle_chip (
--     operacion_detalle_id bigint NOT NULL,
--     chip_id bigint NOT NULL
-- );
--
--
-- --
-- -- Name: fg_operacion_detalle_id_seq; Type: SEQUENCE; Schema: public; Owner: -
-- --
--
-- CREATE SEQUENCE public.fg_operacion_detalle_id_seq
--     START WITH 1
--     INCREMENT BY 1
--     NO MINVALUE
--     NO MAXVALUE
--     CACHE 1;
--
--
-- --
-- -- Name: fg_operacion_detalle_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
-- --
--
-- ALTER SEQUENCE public.fg_operacion_detalle_id_seq OWNED BY public.fg_operacion_detalle.id;
--
--
-- --
-- -- Name: fg_orden_pago; Type: TABLE; Schema: public; Owner: -
-- --
--
-- CREATE TABLE public.fg_orden_pago (
--     id bigint NOT NULL,
--     certificado_id bigint,
--     importe_total double precision NOT NULL,
--     baseimponible double precision NOT NULL,
--     igv double precision NOT NULL,
--     importe_pagado double precision DEFAULT 0 NOT NULL,
--     saldo_pendiente double precision NOT NULL,
--     moneda_key character varying(20) DEFAULT 'sol'::character varying NOT NULL,
--     formapago_key character varying(20) DEFAULT 'contado'::character varying NOT NULL,
--     estado character varying(255) DEFAULT 'PENDIENTE'::character varying NOT NULL,
--     fechacreacion timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
--     fechmodi timestamp without time zone,
--     usuariocreacion_username character varying(255) NOT NULL,
--     usuariomodi_username character varying(255),
--     operacion_id bigint,
--     venta_id bigint,
--     fecha_inicio_credito date,
--     fecha_vencimiento_credito date,
--     CONSTRAINT chk_fg_orden_pago_estado CHECK (((estado)::text = ANY ((ARRAY['PENDIENTE'::character varying, 'PAGADO'::character varying, 'ANULADO'::character varying])::text[]))),
--     CONSTRAINT chk_fg_orden_pago_importe_pagado CHECK ((importe_pagado >= (0)::double precision)),
--     CONSTRAINT chk_fg_orden_pago_periodo_credito CHECK (((fecha_inicio_credito IS NULL) OR (fecha_vencimiento_credito IS NULL) OR (fecha_vencimiento_credito >= fecha_inicio_credito))),
--     CONSTRAINT chk_fg_orden_pago_saldo CHECK ((saldo_pendiente >= (0)::double precision)),
--     CONSTRAINT chk_fg_orden_pago_total CHECK ((importe_total >= (0)::double precision))
-- );
--
--
-- --
-- -- Name: COLUMN fg_orden_pago.fecha_inicio_credito; Type: COMMENT; Schema: public; Owner: -
-- --
--
-- COMMENT ON COLUMN public.fg_orden_pago.fecha_inicio_credito IS 'Fecha inicial del período de crédito capturada en el paso Pago.';
--
--
-- --
-- -- Name: COLUMN fg_orden_pago.fecha_vencimiento_credito; Type: COMMENT; Schema: public; Owner: -
-- --
--
-- COMMENT ON COLUMN public.fg_orden_pago.fecha_vencimiento_credito IS 'Fecha final del período de crédito capturada en el paso Pago.';
--
--
-- --
-- -- Name: fg_orden_pago_id_seq; Type: SEQUENCE; Schema: public; Owner: -
-- --
--
-- ALTER TABLE public.fg_orden_pago ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
--     SEQUENCE NAME public.fg_orden_pago_id_seq
--     START WITH 1
--     INCREMENT BY 1
--     NO MINVALUE
--     NO MAXVALUE
--     CACHE 1
-- );
--
--
-- --
-- -- Name: fg_pago; Type: TABLE; Schema: public; Owner: -
-- --
--
-- CREATE TABLE public.fg_pago (
--     id bigint NOT NULL,
--     baseimponible double precision,
--     digitotarjeta character varying(4),
--     estado character varying(255),
--     fechacreacion timestamp without time zone,
--     fechdeposito timestamp without time zone,
--     igv double precision,
--     importe double precision,
--     nrooperacionbanco character varying(75),
--     nrooperaciontarjeta character varying(75),
--     sendedtooffisis boolean,
--     orden_pago_id bigint,
--     cuentacorriente_key character varying(20),
--     entidadfinanciera_key character varying(20),
--     moneda_key character varying(20),
--     tarjeta_key character varying(20),
--     tipocontado_key character varying(20),
--     modalidad_tarjeta character varying(10),
--     CONSTRAINT chk_fg_pago_digitos CHECK (((digitotarjeta IS NULL) OR ((digitotarjeta)::text ~ '^[0-9]{4}$'::text))),
--     CONSTRAINT chk_fg_pago_importe CHECK ((importe > (0)::double precision)),
--     CONSTRAINT chk_fg_pago_modalidad_tarjeta CHECK (((modalidad_tarjeta IS NULL) OR ((modalidad_tarjeta)::text = ANY ((ARRAY['DEBITO'::character varying, 'CREDITO'::character varying])::text[]))))
-- );
--
--
-- --
-- -- Name: fg_pago_id_seq; Type: SEQUENCE; Schema: public; Owner: -
-- --
--
-- ALTER TABLE public.fg_pago ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
--     SEQUENCE NAME public.fg_pago_id_seq
--     START WITH 1
--     INCREMENT BY 1
--     NO MINVALUE
--     NO MAXVALUE
--     CACHE 1
-- );
--
--
-- --
-- -- Name: fg_perfil; Type: TABLE; Schema: public; Owner: -
-- --
--
-- CREATE TABLE public.fg_perfil (
--     clave character varying(255) NOT NULL,
--     nombre character varying(255) NOT NULL,
--     visible boolean
-- );
--
--
-- --
-- -- Name: fg_perfil_permiso; Type: TABLE; Schema: public; Owner: -
-- --
--
-- CREATE TABLE public.fg_perfil_permiso (
--     perfil_clave character varying(255) NOT NULL,
--     permiso_clave character varying(100) NOT NULL,
--     created_at timestamp with time zone DEFAULT now() NOT NULL
-- );
--
--
-- --
-- -- Name: fg_perfil_planta; Type: TABLE; Schema: public; Owner: -
-- --
--
-- CREATE TABLE public.fg_perfil_planta (
--     perfil_clave character varying(255) NOT NULL,
--     planta_key character varying(20) NOT NULL
-- );
--
--
-- --
-- -- Name: fg_permiso; Type: TABLE; Schema: public; Owner: -
-- --
--
-- CREATE TABLE public.fg_permiso (
--     clave character varying(100) NOT NULL,
--     nombre character varying(200) NOT NULL,
--     modulo character varying(100) NOT NULL,
--     descripcion text,
--     activo boolean DEFAULT true NOT NULL
-- );
--
--
-- --
-- -- Name: fg_planta; Type: TABLE; Schema: public; Owner: -
-- --
--
-- CREATE TABLE public.fg_planta (
--     key character varying(20) NOT NULL,
--     nombre character varying(150) NOT NULL,
--     direccion character varying(500),
--     telefono character varying(255),
--     activo boolean DEFAULT true NOT NULL,
--     empresa_key character varying NOT NULL,
--     correo character varying(255)
-- );
--
--
-- --
-- -- Name: fg_producto_facturacion; Type: TABLE; Schema: public; Owner: -
-- --
--
-- CREATE TABLE public.fg_producto_facturacion (
--     id bigint NOT NULL,
--     codigo_sku character varying(120) NOT NULL,
--     descripcion character varying(300) NOT NULL,
--     tipo_producto character varying(50),
--     categoria_dms character varying(200),
--     cuenta_por_cobrar character varying(200),
--     unidad character varying(20),
--     precio_unitario numeric(14,4),
--     precio_referencia numeric(14,4),
--     valor_referencial_unitario numeric(14,4),
--     codigo_clasificacion_sunat character varying(30),
--     tipo_afectacion_igv character varying(10),
--     porcentaje_isc numeric(8,4),
--     disponible_pos boolean DEFAULT false NOT NULL,
--     es_para_venta boolean DEFAULT true NOT NULL,
--     es_para_compra boolean DEFAULT false NOT NULL,
--     tiene_icbper boolean DEFAULT false NOT NULL,
--     activo boolean DEFAULT true NOT NULL,
--     fecha_creacion timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
--     fecha_modificacion timestamp without time zone,
--     categoria_id integer,
--     requiere_chip boolean DEFAULT false NOT NULL,
--     producto_chip_id bigint,
--     precio_chip numeric(12,2),
--     codigo_barras character varying(120),
--     codigo_afectacion_isc character varying(20),
--     imagen_url text,
--     CONSTRAINT chk_fg_producto_facturacion_afectacion CHECK (((tipo_afectacion_igv IS NULL) OR ((tipo_afectacion_igv)::text ~ '^[0-9]{2}$'::text))),
--     CONSTRAINT chk_fg_producto_facturacion_descripcion CHECK ((btrim((descripcion)::text) <> ''::text)),
--     CONSTRAINT chk_fg_producto_facturacion_porcentaje_isc CHECK (((porcentaje_isc IS NULL) OR (porcentaje_isc >= (0)::numeric))),
--     CONSTRAINT chk_fg_producto_facturacion_precio_referencia CHECK (((precio_referencia IS NULL) OR (precio_referencia >= (0)::numeric))),
--     CONSTRAINT chk_fg_producto_facturacion_precio_unitario CHECK (((precio_unitario IS NULL) OR (precio_unitario >= (0)::numeric))),
--     CONSTRAINT chk_fg_producto_facturacion_sku CHECK ((btrim((codigo_sku)::text) <> ''::text)),
--     CONSTRAINT chk_fg_producto_facturacion_valor_referencial CHECK (((valor_referencial_unitario IS NULL) OR (valor_referencial_unitario >= (0)::numeric))),
--     CONSTRAINT ck_fg_producto_facturacion_chip CHECK ((((requiere_chip = true) AND (producto_chip_id IS NOT NULL)) OR ((requiere_chip = false) AND (producto_chip_id IS NULL)))),
--     CONSTRAINT ck_fg_producto_facturacion_precio_chip CHECK (((precio_chip IS NULL) OR (precio_chip >= (0)::numeric)))
-- );
--
--
-- --
-- -- Name: COLUMN fg_producto_facturacion.precio_referencia; Type: COMMENT; Schema: public; Owner: -
-- --
--
-- COMMENT ON COLUMN public.fg_producto_facturacion.precio_referencia IS 'Precio de venta unitario del maestro comercial; no reemplaza la tarifa por sede.';
--
--
-- --
-- -- Name: COLUMN fg_producto_facturacion.categoria_id; Type: COMMENT; Schema: public; Owner: -
-- --
--
-- COMMENT ON COLUMN public.fg_producto_facturacion.categoria_id IS 'Categoría funcional principal del producto fiscal. Puede ser NULL solo para datos históricos pendientes de clasificación.';
--
--
-- --
-- -- Name: COLUMN fg_producto_facturacion.codigo_barras; Type: COMMENT; Schema: public; Owner: -
-- --
--
-- COMMENT ON COLUMN public.fg_producto_facturacion.codigo_barras IS 'Código de barras opcional proveniente del maestro comercial DMS.';
--
--
-- --
-- -- Name: COLUMN fg_producto_facturacion.codigo_afectacion_isc; Type: COMMENT; Schema: public; Owner: -
-- --
--
-- COMMENT ON COLUMN public.fg_producto_facturacion.codigo_afectacion_isc IS 'Código de afectación ISC opcional del maestro fiscal DMS.';
--
--
-- --
-- -- Name: COLUMN fg_producto_facturacion.imagen_url; Type: COMMENT; Schema: public; Owner: -
-- --
--
-- COMMENT ON COLUMN public.fg_producto_facturacion.imagen_url IS 'URL opcional de la imagen del producto; no almacena binarios.';
--
--
-- --
-- -- Name: fg_producto_facturacion_id_seq; Type: SEQUENCE; Schema: public; Owner: -
-- --
--
-- ALTER TABLE public.fg_producto_facturacion ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
--     SEQUENCE NAME public.fg_producto_facturacion_id_seq
--     START WITH 1
--     INCREMENT BY 1
--     NO MINVALUE
--     NO MAXVALUE
--     CACHE 1
-- );
--
--
-- --
-- -- Name: fg_producto_inventariable; Type: TABLE; Schema: public; Owner: -
-- --
--
-- CREATE TABLE public.fg_producto_inventariable (
--     id bigint NOT NULL,
--     codigo character varying(60) NOT NULL,
--     nombre character varying(200) NOT NULL,
--     producto_facturacion_id bigint,
--     control_stock boolean DEFAULT true NOT NULL,
--     activo boolean DEFAULT true NOT NULL,
--     fecha_creacion timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
--     fecha_modificacion timestamp without time zone,
--     tipo character varying(100) DEFAULT 'OTRO_PRODUCTO_FISICO'::character varying NOT NULL,
--     CONSTRAINT ck_fg_producto_inventariable_codigo CHECK ((btrim((codigo)::text) <> ''::text)),
--     CONSTRAINT ck_fg_producto_inventariable_nombre CHECK ((btrim((nombre)::text) <> ''::text))
-- );
--
--
-- --
-- -- Name: fg_producto_inventariable_id_seq; Type: SEQUENCE; Schema: public; Owner: -
-- --
--
-- ALTER TABLE public.fg_producto_inventariable ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
--     SEQUENCE NAME public.fg_producto_inventariable_id_seq
--     START WITH 1
--     INCREMENT BY 1
--     NO MINVALUE
--     NO MAXVALUE
--     CACHE 1
-- );
--
--
-- --
-- -- Name: fg_producto_inventariable_sede; Type: TABLE; Schema: public; Owner: -
-- --
--
-- CREATE TABLE public.fg_producto_inventariable_sede (
--     id bigint NOT NULL,
--     producto_inventariable_id bigint NOT NULL,
--     planta_key character varying NOT NULL,
--     precio numeric(14,2) NOT NULL,
--     activo boolean DEFAULT true NOT NULL,
--     fecha_creacion timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
--     fecha_modificacion timestamp without time zone,
--     stock_permitido boolean DEFAULT false NOT NULL,
--     venta_habilitada boolean DEFAULT false NOT NULL,
--     producto_facturacion_id bigint,
--     CONSTRAINT ck_fg_producto_inventariable_sede_precio CHECK ((precio > (0)::numeric))
-- );
--
--
-- --
-- -- Name: fg_producto_inventariable_sede_id_seq; Type: SEQUENCE; Schema: public; Owner: -
-- --
--
-- ALTER TABLE public.fg_producto_inventariable_sede ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
--     SEQUENCE NAME public.fg_producto_inventariable_sede_id_seq
--     START WITH 1
--     INCREMENT BY 1
--     NO MINVALUE
--     NO MAXVALUE
--     CACHE 1
-- );
--
--
-- --
-- -- Name: fg_producto_sede; Type: TABLE; Schema: public; Owner: -
-- --
--
-- CREATE TABLE public.fg_producto_sede (
--     id bigint NOT NULL,
--     planta_key character varying NOT NULL,
--     producto_facturacion_id bigint NOT NULL,
--     precio numeric(14,2) NOT NULL,
--     activo boolean DEFAULT true NOT NULL,
--     orden integer DEFAULT 0 NOT NULL,
--     fecha_creacion timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
--     fecha_modificacion timestamp without time zone,
--     CONSTRAINT ck_fg_producto_sede_orden CHECK ((orden >= 0)),
--     CONSTRAINT ck_fg_producto_sede_precio CHECK ((precio > (0)::numeric))
-- );
--
--
-- --
-- -- Name: fg_producto_sede_id_seq; Type: SEQUENCE; Schema: public; Owner: -
-- --
--
-- CREATE SEQUENCE public.fg_producto_sede_id_seq
--     START WITH 1
--     INCREMENT BY 1
--     NO MINVALUE
--     NO MAXVALUE
--     CACHE 1;
--
--
-- --
-- -- Name: fg_producto_sede_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
-- --
--
-- ALTER SEQUENCE public.fg_producto_sede_id_seq OWNED BY public.fg_producto_sede.id;
--
--
-- --
-- -- Name: fg_serie_comprobante; Type: TABLE; Schema: public; Owner: -
-- --
--
-- CREATE TABLE public.fg_serie_comprobante (
--     id bigint NOT NULL,
--     planta_key character varying(50) NOT NULL,
--     tipo_comprobante character varying(30) NOT NULL,
--     serie character varying(30) NOT NULL,
--     ultimo_numero bigint DEFAULT 0 NOT NULL,
--     es_predeterminada boolean DEFAULT false NOT NULL,
--     autogenerada boolean DEFAULT true NOT NULL,
--     contingencia boolean DEFAULT false NOT NULL,
--     activo boolean DEFAULT true NOT NULL,
--     fecha_creacion timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
--     fecha_modificacion timestamp without time zone,
--     tipo_documento_referencia character varying(2),
--     serie_pos boolean DEFAULT false NOT NULL,
--     empresa_key character varying,
--     proveedor_emision character varying(30) DEFAULT 'LEGACY'::character varying NOT NULL,
--     entorno_emision character varying(15) DEFAULT 'DEMO'::character varying NOT NULL,
--     confirmada_produccion boolean DEFAULT false NOT NULL,
--     numero_inicial_confirmado bigint,
--     sistema_origen character varying(30),
--     fecha_corte timestamp without time zone,
--     usuario_confirmacion character varying(255),
--     fecha_confirmacion timestamp without time zone,
--     nombre_dms character varying(30),
--     codigo_local_dms character varying(10),
--     nombre_local_dms character varying(80),
--     telefono_local_dms character varying(30),
--     correo_local_dms character varying(120),
--     direccion_comercial_dms character varying(200),
--     CONSTRAINT chk_fg_serie_comprobante_numero CHECK ((ultimo_numero >= 0)),
--     CONSTRAINT chk_fg_serie_comprobante_serie CHECK ((btrim((serie)::text) <> ''::text)),
--     CONSTRAINT chk_fg_serie_comprobante_tipo CHECK (((tipo_comprobante)::text = ANY ((ARRAY['FACTURA'::character varying, 'BOLETA'::character varying, 'NOTA_CREDITO_FACTURA'::character varying, 'NOTA_CREDITO_BOLETA'::character varying, 'NOTA_DEBITO_FACTURA'::character varying, 'NOTA_DEBITO_BOLETA'::character varying])::text[]))),
--     CONSTRAINT ck_fg_serie_entorno_emision CHECK (((entorno_emision)::text = ANY ((ARRAY['DEMO'::character varying, 'PRODUCCION'::character varying])::text[]))),
--     CONSTRAINT ck_fg_serie_numero_inicial_confirmado CHECK (((numero_inicial_confirmado IS NULL) OR (numero_inicial_confirmado >= 0))),
--     CONSTRAINT ck_fg_serie_proveedor_emision CHECK (((proveedor_emision)::text = ANY ((ARRAY['LEGACY'::character varying, 'NUBEFACT'::character varying])::text[])))
-- );
--
--
-- --
-- -- Name: fg_serie_comprobante_id_seq; Type: SEQUENCE; Schema: public; Owner: -
-- --
--
-- ALTER TABLE public.fg_serie_comprobante ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
--     SEQUENCE NAME public.fg_serie_comprobante_id_seq
--     START WITH 1
--     INCREMENT BY 1
--     NO MINVALUE
--     NO MAXVALUE
--     CACHE 1
-- );
--
--
-- --
-- -- Name: fg_servicio; Type: TABLE; Schema: public; Owner: -
-- --
--
-- CREATE TABLE public.fg_servicio (
--     id integer NOT NULL,
--     codigo character varying(50) NOT NULL,
--     nombre character varying(150) NOT NULL,
--     familia character varying(50) NOT NULL,
--     tipo_certificado_clave character varying(50),
--     modalidad character varying(50),
--     requiere_certificado boolean DEFAULT true NOT NULL,
--     requiere_vehiculo boolean DEFAULT true NOT NULL,
--     activo boolean DEFAULT true NOT NULL,
--     orden integer DEFAULT 0 NOT NULL,
--     categoria_id integer NOT NULL,
--     tipo_flujo character varying(30) NOT NULL,
--     formato_id integer,
--     CONSTRAINT ck_fg_servicio_tipo_flujo CHECK (((tipo_flujo)::text = ANY ((ARRAY['CERTIFICACION'::character varying, 'SERVICIO_COMPLEMENTARIO'::character varying, 'VEHICULAR_EXISTENTE'::character varying, 'TALLER_INSPECCION'::character varying, 'PRODUCTO_SOLAMENTE'::character varying])::text[])))
-- );
--
--
-- --
-- -- Name: fg_servicio_id_seq; Type: SEQUENCE; Schema: public; Owner: -
-- --
--
-- CREATE SEQUENCE public.fg_servicio_id_seq
--     AS integer
--     START WITH 1
--     INCREMENT BY 1
--     NO MINVALUE
--     NO MAXVALUE
--     CACHE 1;
--
--
-- --
-- -- Name: fg_servicio_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
-- --
--
-- ALTER SEQUENCE public.fg_servicio_id_seq OWNED BY public.fg_servicio.id;
--
--
-- --
-- -- Name: fg_taller_autorizado; Type: TABLE; Schema: public; Owner: -
-- --
--
-- CREATE TABLE public.fg_taller_autorizado (
--     id bigint NOT NULL,
--     ruc character varying(11),
--     razon_social character varying(300) NOT NULL,
--     nombre_comercial character varying(300),
--     sede character varying(200),
--     direccion character varying(500),
--     codigo_autorizacion character varying(100),
--     estado boolean DEFAULT true NOT NULL,
--     fecha_creacion timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
--     fecha_modificacion timestamp without time zone,
--     planta_key character varying(20)
-- );
--
--
-- --
-- -- Name: fg_taller_autorizado_id_seq; Type: SEQUENCE; Schema: public; Owner: -
-- --
--
-- CREATE SEQUENCE public.fg_taller_autorizado_id_seq
--     START WITH 1
--     INCREMENT BY 1
--     NO MINVALUE
--     NO MAXVALUE
--     CACHE 1;
--
--
-- --
-- -- Name: fg_taller_autorizado_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
-- --
--
-- ALTER SEQUENCE public.fg_taller_autorizado_id_seq OWNED BY public.fg_taller_autorizado.id;
--
--
-- --
-- -- Name: fg_tarifa; Type: TABLE; Schema: public; Owner: -
-- --
--
-- CREATE TABLE public.fg_tarifa (
--     id integer NOT NULL,
--     planta_key character varying(20) NOT NULL,
--     codigo character varying(50) NOT NULL,
--     familia character varying(30) NOT NULL,
--     nombre character varying(150) NOT NULL,
--     tipo_certificado_clave character varying(50),
--     modalidad character varying(20),
--     precio numeric(10,2) NOT NULL,
--     activo boolean DEFAULT true NOT NULL,
--     orden integer DEFAULT 0 NOT NULL,
--     servicio_id integer NOT NULL,
--     producto_facturacion_id bigint,
--     CONSTRAINT chk_fg_tarifa_precio_positivo CHECK ((precio > (0)::numeric))
-- );
--
--
-- --
-- -- Name: fg_tarifa_id_seq; Type: SEQUENCE; Schema: public; Owner: -
-- --
--
-- CREATE SEQUENCE public.fg_tarifa_id_seq
--     AS integer
--     START WITH 1
--     INCREMENT BY 1
--     NO MINVALUE
--     NO MAXVALUE
--     CACHE 1;
--
--
-- --
-- -- Name: fg_tarifa_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
-- --
--
-- ALTER SEQUENCE public.fg_tarifa_id_seq OWNED BY public.fg_tarifa.id;
--
--
-- --
-- -- Name: fg_tipo_certificado; Type: TABLE; Schema: public; Owner: -
-- --
--
-- CREATE TABLE public.fg_tipo_certificado (
--     clave character varying(30) NOT NULL,
--     nombre character varying(100) NOT NULL,
--     descripcion character varying(300),
--     activo boolean DEFAULT true NOT NULL,
--     entidad_certificadora_nombre character varying(300),
--     resolucion_directoral character varying(150),
--     domicilio_fiscal character varying(500),
--     telefono character varying(30),
--     lugar_emision character varying(150),
--     codigo character varying(2) NOT NULL,
--     ancho_correlativo smallint,
--     CONSTRAINT ck_fg_tipo_certificado_ancho_correlativo CHECK (((ancho_correlativo IS NULL) OR ((ancho_correlativo >= 1) AND (ancho_correlativo <= 12))))
-- );
--
--
-- --
-- -- Name: fg_usuario; Type: TABLE; Schema: public; Owner: -
-- --
--
-- CREATE TABLE public.fg_usuario (
--     username character varying(255) NOT NULL,
--     user_type character varying(31) NOT NULL,
--     contrasenha character varying(255) NOT NULL,
--     perfil_id character varying(255),
--     persona_nrodocumentoidentidad character varying(20),
--     estado boolean,
--     foto text
-- );
--
--
-- --
-- -- Name: fg_usuario_perfil; Type: TABLE; Schema: public; Owner: -
-- --
--
-- CREATE TABLE public.fg_usuario_perfil (
--     usuario_username character varying(255) NOT NULL,
--     tipo_documento_key character varying(20) NOT NULL,
--     nro_documento character varying(20) NOT NULL,
--     nombres character varying(200),
--     apellidos character varying(200),
--     nombre_razon_social character varying(500),
--     pais_key character varying(20),
--     departamento_key character varying(20),
--     provincia_key character varying(20),
--     distrito_key character varying(20),
--     direccion character varying(500),
--     email character varying(150),
--     telefono character varying(100),
--     persona_contacto character varying(255),
--     fecha_creacion timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
--     fecha_actualizacion timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
-- );
--
--
-- --
-- -- Name: fg_usuario_planta; Type: TABLE; Schema: public; Owner: -
-- --
--
-- CREATE TABLE public.fg_usuario_planta (
--     usuario_username character varying(255) NOT NULL,
--     plantas_key character varying(20) NOT NULL
-- );
--
--
-- --
-- -- Name: fg_usuario_sesion; Type: TABLE; Schema: public; Owner: -
-- --
--
-- CREATE TABLE public.fg_usuario_sesion (
--     id bigint NOT NULL,
--     usuario_username character varying(255) NOT NULL,
--     logintime_utc timestamp without time zone DEFAULT timezone('UTC'::text, now()) NOT NULL,
--     isactive boolean DEFAULT true NOT NULL,
--     server_name character varying(100),
--     clienteip character varying(45),
--     logouttime_utc timestamp without time zone,
--     session_jti uuid NOT NULL,
--     revoked_at_utc timestamp without time zone,
--     jwt_jti uuid,
--     access_expires_utc timestamp without time zone,
--     refresh_token_hash text,
--     refresh_expires_utc timestamp without time zone,
--     planta_key character varying(20)
-- );
--
--
-- --
-- -- Name: fg_usuario_sesion_id_seq; Type: SEQUENCE; Schema: public; Owner: -
-- --
--
-- CREATE SEQUENCE public.fg_usuario_sesion_id_seq
--     START WITH 1
--     INCREMENT BY 1
--     NO MINVALUE
--     NO MAXVALUE
--     CACHE 1;
--
--
-- --
-- -- Name: fg_usuario_sesion_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
-- --
--
-- ALTER SEQUENCE public.fg_usuario_sesion_id_seq OWNED BY public.fg_usuario_sesion.id;
--
--
-- --
-- -- Name: fg_vehiculo; Type: TABLE; Schema: public; Owner: -
-- --
--
-- CREATE TABLE public.fg_vehiculo (
--     id bigint NOT NULL,
--     placa character varying(255) NOT NULL,
--     placa_normalizada character varying(255) GENERATED ALWAYS AS (upper(btrim((placa)::text))) STORED,
--     categoria character varying(255),
--     clase character varying(255),
--     marca character varying(255),
--     modelo character varying(255),
--     version character varying(255),
--     anio_fabricacion character varying(10),
--     anio_modelo character varying(10),
--     vin character varying(255),
--     serie_chasis character varying(255),
--     numero_motor character varying(255),
--     combustible character varying(255),
--     color character varying(255),
--     carroceria character varying(255),
--     numero_cilindros character varying(50),
--     cilindrada character varying(50),
--     numero_ejes character varying(50),
--     numero_ruedas character varying(50),
--     numero_asientos character varying(50),
--     numero_pasajeros character varying(50),
--     longitud character varying(50),
--     ancho character varying(50),
--     alto character varying(50),
--     peso_neto character varying(50),
--     peso_bruto character varying(50),
--     carga_util character varying(50),
--     potencia character varying(100),
--     formula_rodante character varying(50),
--     fuente_ultima character varying(20) NOT NULL,
--     certificado_origen_id bigint,
--     confirmado boolean DEFAULT false NOT NULL,
--     usuario_creacion character varying(255) NOT NULL,
--     fecha_creacion timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
--     usuario_modificacion character varying(255),
--     fecha_modificacion timestamp without time zone,
--     CONSTRAINT ck_fg_vehiculo_fuente CHECK (((fuente_ultima)::text = ANY ((ARRAY['FARENET'::character varying, 'FAREGAS'::character varying, 'MANUAL'::character varying])::text[]))),
--     CONSTRAINT ck_fg_vehiculo_placa_no_vacia CHECK ((btrim((placa)::text) <> ''::text))
-- );
--
--
-- --
-- -- Name: fg_vehiculo_id_seq; Type: SEQUENCE; Schema: public; Owner: -
-- --
--
-- ALTER TABLE public.fg_vehiculo ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
--     SEQUENCE NAME public.fg_vehiculo_id_seq
--     START WITH 1
--     INCREMENT BY 1
--     NO MINVALUE
--     NO MAXVALUE
--     CACHE 1
-- );
--
--
-- --
-- -- Name: fg_venta; Type: TABLE; Schema: public; Owner: -
-- --
--
-- CREATE TABLE public.fg_venta (
--     id bigint NOT NULL,
--     planta_key character varying(50) NOT NULL,
--     cliente_tipo_documento character varying(20) NOT NULL,
--     cliente_nro_documento character varying(20) NOT NULL,
--     cliente_nombre character varying(255) NOT NULL,
--     cliente_direccion character varying(255),
--     cliente_email character varying(255),
--     base_imponible numeric(10,2) NOT NULL,
--     igv numeric(10,2) NOT NULL,
--     importe_total numeric(10,2) NOT NULL,
--     estado character varying(50) DEFAULT 'COMPLETADO'::character varying,
--     creado_por character varying(100),
--     creado_en timestamp without time zone DEFAULT CURRENT_TIMESTAMP
-- );
--
--
-- --
-- -- Name: fg_venta_detalle; Type: TABLE; Schema: public; Owner: -
-- --
--
-- CREATE TABLE public.fg_venta_detalle (
--     id bigint NOT NULL,
--     venta_id bigint NOT NULL,
--     chip_id bigint NOT NULL,
--     producto_inventariable_id bigint NOT NULL,
--     precio_unitario numeric(10,2) NOT NULL,
--     cantidad integer DEFAULT 1,
--     total numeric(10,2) NOT NULL
-- );
--
--
-- --
-- -- Name: fg_venta_detalle_id_seq; Type: SEQUENCE; Schema: public; Owner: -
-- --
--
-- CREATE SEQUENCE public.fg_venta_detalle_id_seq
--     START WITH 1
--     INCREMENT BY 1
--     NO MINVALUE
--     NO MAXVALUE
--     CACHE 1;
--
--
-- --
-- -- Name: fg_venta_detalle_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
-- --
--
-- ALTER SEQUENCE public.fg_venta_detalle_id_seq OWNED BY public.fg_venta_detalle.id;
--
--
-- --
-- -- Name: fg_venta_id_seq; Type: SEQUENCE; Schema: public; Owner: -
-- --
--
-- CREATE SEQUENCE public.fg_venta_id_seq
--     START WITH 1
--     INCREMENT BY 1
--     NO MINVALUE
--     NO MAXVALUE
--     CACHE 1;
--
--
-- --
-- -- Name: fg_venta_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
-- --
--
-- ALTER SEQUENCE public.fg_venta_id_seq OWNED BY public.fg_venta.id;
--
--
-- --
-- -- Name: fg_auditoria_acceso id; Type: DEFAULT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_auditoria_acceso ALTER COLUMN id SET DEFAULT nextval('public.fg_auditoria_acceso_id_seq'::regclass);
--
--
-- --
-- -- Name: fg_auditoria_config id; Type: DEFAULT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_auditoria_config ALTER COLUMN id SET DEFAULT nextval('public.fg_auditoria_config_id_seq'::regclass);
--
--
-- --
-- -- Name: fg_certificado id; Type: DEFAULT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_certificado ALTER COLUMN id SET DEFAULT nextval('public.fg_certificado_id_seq'::regclass);
--
--
-- --
-- -- Name: fg_certificado_formato id; Type: DEFAULT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_certificado_formato ALTER COLUMN id SET DEFAULT nextval('public.fg_certificado_formato_id_seq'::regclass);
--
--
-- --
-- -- Name: fg_certificado_formato_version id; Type: DEFAULT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_certificado_formato_version ALTER COLUMN id SET DEFAULT nextval('public.fg_certificado_formato_version_id_seq'::regclass);
--
--
-- --
-- -- Name: fg_certificado_glp_componente id; Type: DEFAULT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_certificado_glp_componente ALTER COLUMN id SET DEFAULT nextval('public.fg_certificado_glp_componente_id_seq'::regclass);
--
--
-- --
-- -- Name: fg_certificado_glp_verificacion id; Type: DEFAULT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_certificado_glp_verificacion ALTER COLUMN id SET DEFAULT nextval('public.fg_certificado_glp_verificacion_id_seq'::regclass);
--
--
-- --
-- -- Name: fg_certificado_gnv_componente id; Type: DEFAULT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_certificado_gnv_componente ALTER COLUMN id SET DEFAULT nextval('public.fg_certificado_gnv_componente_id_seq'::regclass);
--
--
-- --
-- -- Name: fg_certificado_gnv_verificacion id; Type: DEFAULT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_certificado_gnv_verificacion ALTER COLUMN id SET DEFAULT nextval('public.fg_certificado_gnv_verificacion_id_seq'::regclass);
--
--
-- --
-- -- Name: fg_certificado_titular id; Type: DEFAULT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_certificado_titular ALTER COLUMN id SET DEFAULT nextval('public.fg_certificado_titular_id_seq'::regclass);
--
--
-- --
-- -- Name: fg_cliente id; Type: DEFAULT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_cliente ALTER COLUMN id SET DEFAULT nextval('public.fg_cliente_id_seq'::regclass);
--
--
-- --
-- -- Name: fg_correlativo_certificado id; Type: DEFAULT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_correlativo_certificado ALTER COLUMN id SET DEFAULT nextval('public.fg_correlativo_certificado_id_seq'::regclass);
--
--
-- --
-- -- Name: fg_correlativo_certificado_sede id; Type: DEFAULT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_correlativo_certificado_sede ALTER COLUMN id SET DEFAULT nextval('public.fg_correlativo_certificado_sede_id_seq'::regclass);
--
--
-- --
-- -- Name: fg_credito id; Type: DEFAULT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_credito ALTER COLUMN id SET DEFAULT nextval('public.fg_credito_id_seq'::regclass);
--
--
-- --
-- -- Name: fg_debito id; Type: DEFAULT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_debito ALTER COLUMN id SET DEFAULT nextval('public.fg_debito_id_seq'::regclass);
--
--
-- --
-- -- Name: fg_descuento id; Type: DEFAULT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_descuento ALTER COLUMN id SET DEFAULT nextval('public.fg_descuento_id_seq'::regclass);
--
--
-- --
-- -- Name: fg_descuentocliente id; Type: DEFAULT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_descuentocliente ALTER COLUMN id SET DEFAULT nextval('public.fg_descuentocliente_id_seq'::regclass);
--
--
-- --
-- -- Name: fg_descuentocomprobante id; Type: DEFAULT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_descuentocomprobante ALTER COLUMN id SET DEFAULT nextval('public.fg_descuentocomprobante_id_seq'::regclass);
--
--
-- --
-- -- Name: fg_descuentodetalle id; Type: DEFAULT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_descuentodetalle ALTER COLUMN id SET DEFAULT nextval('public.fg_descuentodetalle_id_seq'::regclass);
--
--
-- --
-- -- Name: fg_ejecutivo id; Type: DEFAULT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_ejecutivo ALTER COLUMN id SET DEFAULT nextval('public.fg_ejecutivo_id_seq'::regclass);
--
--
-- --
-- -- Name: fg_operacion_comercial id; Type: DEFAULT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_operacion_comercial ALTER COLUMN id SET DEFAULT nextval('public.fg_operacion_comercial_id_seq'::regclass);
--
--
-- --
-- -- Name: fg_operacion_detalle id; Type: DEFAULT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_operacion_detalle ALTER COLUMN id SET DEFAULT nextval('public.fg_operacion_detalle_id_seq'::regclass);
--
--
-- --
-- -- Name: fg_producto_sede id; Type: DEFAULT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_producto_sede ALTER COLUMN id SET DEFAULT nextval('public.fg_producto_sede_id_seq'::regclass);
--
--
-- --
-- -- Name: fg_servicio id; Type: DEFAULT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_servicio ALTER COLUMN id SET DEFAULT nextval('public.fg_servicio_id_seq'::regclass);
--
--
-- --
-- -- Name: fg_taller_autorizado id; Type: DEFAULT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_taller_autorizado ALTER COLUMN id SET DEFAULT nextval('public.fg_taller_autorizado_id_seq'::regclass);
--
--
-- --
-- -- Name: fg_tarifa id; Type: DEFAULT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_tarifa ALTER COLUMN id SET DEFAULT nextval('public.fg_tarifa_id_seq'::regclass);
--
--
-- --
-- -- Name: fg_usuario_sesion id; Type: DEFAULT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_usuario_sesion ALTER COLUMN id SET DEFAULT nextval('public.fg_usuario_sesion_id_seq'::regclass);
--
--
-- --
-- -- Name: fg_venta id; Type: DEFAULT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_venta ALTER COLUMN id SET DEFAULT nextval('public.fg_venta_id_seq'::regclass);
--
--
-- --
-- -- Name: fg_venta_detalle id; Type: DEFAULT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_venta_detalle ALTER COLUMN id SET DEFAULT nextval('public.fg_venta_detalle_id_seq'::regclass);
--
--
-- --
-- -- Name: fg_correlativo_certificado_sede excl_fg_corr_sede_rango; Type: CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_correlativo_certificado_sede
--     ADD CONSTRAINT excl_fg_corr_sede_rango EXCLUDE USING gist (int8range(rango_inicio, rango_fin, '[]'::text) WITH &&);
--
--
-- --
-- -- Name: fg_correlativo_certificado excl_fg_correlativo_rango; Type: CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_correlativo_certificado
--     ADD CONSTRAINT excl_fg_correlativo_rango EXCLUDE USING gist (tipo_certificado_clave WITH =, int8range(nro_inicio, nro_maximo, '[]'::text) WITH &&);
--
--
-- --
-- -- Name: fg_auditoria_acceso fg_auditoria_acceso_pkey; Type: CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_auditoria_acceso
--     ADD CONSTRAINT fg_auditoria_acceso_pkey PRIMARY KEY (id);
--
--
-- --
-- -- Name: fg_auditoria_config fg_auditoria_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_auditoria_config
--     ADD CONSTRAINT fg_auditoria_config_pkey PRIMARY KEY (id);
--
--
-- --
-- -- Name: fg_categoria_servicio fg_categoria_servicio_pkey; Type: CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_categoria_servicio
--     ADD CONSTRAINT fg_categoria_servicio_pkey PRIMARY KEY (id);
--
--
-- --
-- -- Name: fg_certificado_chip fg_certificado_chip_pkey; Type: CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_certificado_chip
--     ADD CONSTRAINT fg_certificado_chip_pkey PRIMARY KEY (certificado_id, chip_id);
--
--
-- --
-- -- Name: fg_certificado_conformidad fg_certificado_conformidad_pkey; Type: CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_certificado_conformidad
--     ADD CONSTRAINT fg_certificado_conformidad_pkey PRIMARY KEY (certificado_id);
--
--
-- --
-- -- Name: fg_certificado_formato fg_certificado_formato_codigo_key; Type: CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_certificado_formato
--     ADD CONSTRAINT fg_certificado_formato_codigo_key UNIQUE (codigo);
--
--
-- --
-- -- Name: fg_certificado_formato fg_certificado_formato_pkey; Type: CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_certificado_formato
--     ADD CONSTRAINT fg_certificado_formato_pkey PRIMARY KEY (id);
--
--
-- --
-- -- Name: fg_certificado_formato_version fg_certificado_formato_version_formato_id_version_key; Type: CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_certificado_formato_version
--     ADD CONSTRAINT fg_certificado_formato_version_formato_id_version_key UNIQUE (formato_id, version);
--
--
-- --
-- -- Name: fg_certificado_formato_version fg_certificado_formato_version_pkey; Type: CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_certificado_formato_version
--     ADD CONSTRAINT fg_certificado_formato_version_pkey PRIMARY KEY (id);
--
--
-- --
-- -- Name: fg_certificado_glp_componente fg_certificado_glp_componente_certificado_id_orden_key; Type: CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_certificado_glp_componente
--     ADD CONSTRAINT fg_certificado_glp_componente_certificado_id_orden_key UNIQUE (certificado_id, orden);
--
--
-- --
-- -- Name: fg_certificado_glp_componente fg_certificado_glp_componente_pkey; Type: CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_certificado_glp_componente
--     ADD CONSTRAINT fg_certificado_glp_componente_pkey PRIMARY KEY (id);
--
--
-- --
-- -- Name: fg_certificado_glp fg_certificado_glp_pkey; Type: CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_certificado_glp
--     ADD CONSTRAINT fg_certificado_glp_pkey PRIMARY KEY (certificado_id);
--
--
-- --
-- -- Name: fg_certificado_glp_verificacion fg_certificado_glp_verificacion_certificado_id_codigo_key; Type: CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_certificado_glp_verificacion
--     ADD CONSTRAINT fg_certificado_glp_verificacion_certificado_id_codigo_key UNIQUE (certificado_id, codigo);
--
--
-- --
-- -- Name: fg_certificado_glp_verificacion fg_certificado_glp_verificacion_certificado_id_orden_key; Type: CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_certificado_glp_verificacion
--     ADD CONSTRAINT fg_certificado_glp_verificacion_certificado_id_orden_key UNIQUE (certificado_id, orden);
--
--
-- --
-- -- Name: fg_certificado_glp_verificacion fg_certificado_glp_verificacion_pkey; Type: CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_certificado_glp_verificacion
--     ADD CONSTRAINT fg_certificado_glp_verificacion_pkey PRIMARY KEY (id);
--
--
-- --
-- -- Name: fg_certificado_gnv_componente fg_certificado_gnv_componente_certificado_id_orden_key; Type: CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_certificado_gnv_componente
--     ADD CONSTRAINT fg_certificado_gnv_componente_certificado_id_orden_key UNIQUE (certificado_id, orden);
--
--
-- --
-- -- Name: fg_certificado_gnv_componente fg_certificado_gnv_componente_pkey; Type: CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_certificado_gnv_componente
--     ADD CONSTRAINT fg_certificado_gnv_componente_pkey PRIMARY KEY (id);
--
--
-- --
-- -- Name: fg_certificado_gnv fg_certificado_gnv_pkey; Type: CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_certificado_gnv
--     ADD CONSTRAINT fg_certificado_gnv_pkey PRIMARY KEY (certificado_id);
--
--
-- --
-- -- Name: fg_certificado_gnv_verificacion fg_certificado_gnv_verificacion_certificado_id_codigo_key; Type: CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_certificado_gnv_verificacion
--     ADD CONSTRAINT fg_certificado_gnv_verificacion_certificado_id_codigo_key UNIQUE (certificado_id, codigo);
--
--
-- --
-- -- Name: fg_certificado_gnv_verificacion fg_certificado_gnv_verificacion_certificado_id_orden_key; Type: CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_certificado_gnv_verificacion
--     ADD CONSTRAINT fg_certificado_gnv_verificacion_certificado_id_orden_key UNIQUE (certificado_id, orden);
--
--
-- --
-- -- Name: fg_certificado_gnv_verificacion fg_certificado_gnv_verificacion_pkey; Type: CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_certificado_gnv_verificacion
--     ADD CONSTRAINT fg_certificado_gnv_verificacion_pkey PRIMARY KEY (id);
--
--
-- --
-- -- Name: fg_certificado fg_certificado_numero_certificado_key; Type: CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_certificado
--     ADD CONSTRAINT fg_certificado_numero_certificado_key UNIQUE (numero_certificado);
--
--
-- --
-- -- Name: fg_certificado fg_certificado_pkey; Type: CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_certificado
--     ADD CONSTRAINT fg_certificado_pkey PRIMARY KEY (id);
--
--
-- --
-- -- Name: fg_certificado_titular fg_certificado_titular_certificado_id_orden_key; Type: CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_certificado_titular
--     ADD CONSTRAINT fg_certificado_titular_certificado_id_orden_key UNIQUE (certificado_id, orden);
--
--
-- --
-- -- Name: fg_certificado_titular fg_certificado_titular_pkey; Type: CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_certificado_titular
--     ADD CONSTRAINT fg_certificado_titular_pkey PRIMARY KEY (id);
--
--
-- --
-- -- Name: fg_certificado_vehiculo fg_certificado_vehiculo_pkey; Type: CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_certificado_vehiculo
--     ADD CONSTRAINT fg_certificado_vehiculo_pkey PRIMARY KEY (certificado_id);
--
--
-- --
-- -- Name: fg_chip_movimiento fg_chip_movimiento_pkey; Type: CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_chip_movimiento
--     ADD CONSTRAINT fg_chip_movimiento_pkey PRIMARY KEY (id);
--
--
-- --
-- -- Name: fg_chip fg_chip_numero_chip_key; Type: CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_chip
--     ADD CONSTRAINT fg_chip_numero_chip_key UNIQUE (numero_chip);
--
--
-- --
-- -- Name: fg_chip fg_chip_pkey; Type: CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_chip
--     ADD CONSTRAINT fg_chip_pkey PRIMARY KEY (id);
--
--
-- --
-- -- Name: fg_cliente fg_cliente_pkey; Type: CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_cliente
--     ADD CONSTRAINT fg_cliente_pkey PRIMARY KEY (id);
--
--
-- --
-- -- Name: fg_cliente fg_cliente_tipo_documento_nro_documento_key; Type: CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_cliente
--     ADD CONSTRAINT fg_cliente_tipo_documento_nro_documento_key UNIQUE (tipo_documento, nro_documento);
--
--
-- --
-- -- Name: fg_correlativo_certificado fg_correlativo_certificado_hist_key; Type: CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_correlativo_certificado
--     ADD CONSTRAINT fg_correlativo_certificado_hist_key UNIQUE (planta_key, tipo_certificado_clave, modalidad, nro_inicio, nro_maximo);
--
--
-- --
-- -- Name: fg_correlativo_certificado fg_correlativo_certificado_pkey; Type: CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_correlativo_certificado
--     ADD CONSTRAINT fg_correlativo_certificado_pkey PRIMARY KEY (id);
--
--
-- --
-- -- Name: fg_correlativo_certificado_sede fg_correlativo_certificado_sede_pkey; Type: CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_correlativo_certificado_sede
--     ADD CONSTRAINT fg_correlativo_certificado_sede_pkey PRIMARY KEY (id);
--
--
-- --
-- -- Name: fg_credito fg_credito_pkey; Type: CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_credito
--     ADD CONSTRAINT fg_credito_pkey PRIMARY KEY (id);
--
--
-- --
-- -- Name: fg_debito fg_debito_pkey; Type: CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_debito
--     ADD CONSTRAINT fg_debito_pkey PRIMARY KEY (id);
--
--
-- --
-- -- Name: fg_descuento fg_descuento_pkey; Type: CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_descuento
--     ADD CONSTRAINT fg_descuento_pkey PRIMARY KEY (id);
--
--
-- --
-- -- Name: fg_descuentocliente fg_descuentocliente_pkey; Type: CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_descuentocliente
--     ADD CONSTRAINT fg_descuentocliente_pkey PRIMARY KEY (id);
--
--
-- --
-- -- Name: fg_descuentocomprobante fg_descuentocomprobante_pkey; Type: CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_descuentocomprobante
--     ADD CONSTRAINT fg_descuentocomprobante_pkey PRIMARY KEY (id);
--
--
-- --
-- -- Name: fg_descuentodetalle fg_descuentodetalle_pkey; Type: CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_descuentodetalle
--     ADD CONSTRAINT fg_descuentodetalle_pkey PRIMARY KEY (id);
--
--
-- --
-- -- Name: fg_documento_anulacion fg_documento_anulacion_pkey; Type: CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_documento_anulacion
--     ADD CONSTRAINT fg_documento_anulacion_pkey PRIMARY KEY (id);
--
--
-- --
-- -- Name: fg_documento_electronico_operacion fg_documento_electronico_operacion_pkey; Type: CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_documento_electronico_operacion
--     ADD CONSTRAINT fg_documento_electronico_operacion_pkey PRIMARY KEY (id);
--
--
-- --
-- -- Name: fg_ejecutivo fg_ejecutivo_pkey; Type: CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_ejecutivo
--     ADD CONSTRAINT fg_ejecutivo_pkey PRIMARY KEY (id);
--
--
-- --
-- -- Name: fg_empresa_facturador fg_empresa_facturador_pkey; Type: CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_empresa_facturador
--     ADD CONSTRAINT fg_empresa_facturador_pkey PRIMARY KEY (id);
--
--
-- --
-- -- Name: fg_empresa fg_empresa_pkey; Type: CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_empresa
--     ADD CONSTRAINT fg_empresa_pkey PRIMARY KEY (key);
--
--
-- --
-- -- Name: fg_facturacion fg_facturacion_certificado_id_key; Type: CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_facturacion
--     ADD CONSTRAINT fg_facturacion_certificado_id_key UNIQUE (certificado_id);
--
--
-- --
-- -- Name: fg_facturacion_cuota fg_facturacion_cuota_pkey; Type: CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_facturacion_cuota
--     ADD CONSTRAINT fg_facturacion_cuota_pkey PRIMARY KEY (id);
--
--
-- --
-- -- Name: fg_facturacion_intento fg_facturacion_intento_pkey; Type: CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_facturacion_intento
--     ADD CONSTRAINT fg_facturacion_intento_pkey PRIMARY KEY (id);
--
--
-- --
-- -- Name: fg_facturacion fg_facturacion_pkey; Type: CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_facturacion
--     ADD CONSTRAINT fg_facturacion_pkey PRIMARY KEY (id);
--
--
-- --
-- -- Name: fg_inventario_cantidad_movimiento fg_inventario_cantidad_movimiento_pkey; Type: CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_inventario_cantidad_movimiento
--     ADD CONSTRAINT fg_inventario_cantidad_movimiento_pkey PRIMARY KEY (id);
--
--
-- --
-- -- Name: fg_inventario_cantidad_movimiento fg_inventario_cantidad_movimiento_venta_uk; Type: CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_inventario_cantidad_movimiento
--     ADD CONSTRAINT fg_inventario_cantidad_movimiento_venta_uk UNIQUE (operacion_detalle_id);
--
--
-- --
-- -- Name: fg_operacion_comercial fg_operacion_comercial_pkey; Type: CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_operacion_comercial
--     ADD CONSTRAINT fg_operacion_comercial_pkey PRIMARY KEY (id);
--
--
-- --
-- -- Name: fg_operacion_detalle_chip fg_operacion_detalle_chip_chip_id_key; Type: CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_operacion_detalle_chip
--     ADD CONSTRAINT fg_operacion_detalle_chip_chip_id_key UNIQUE (chip_id);
--
--
-- --
-- -- Name: fg_operacion_detalle_chip fg_operacion_detalle_chip_pkey; Type: CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_operacion_detalle_chip
--     ADD CONSTRAINT fg_operacion_detalle_chip_pkey PRIMARY KEY (operacion_detalle_id);
--
--
-- --
-- -- Name: fg_operacion_detalle fg_operacion_detalle_pkey; Type: CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_operacion_detalle
--     ADD CONSTRAINT fg_operacion_detalle_pkey PRIMARY KEY (id);
--
--
-- --
-- -- Name: fg_orden_pago fg_orden_pago_pkey; Type: CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_orden_pago
--     ADD CONSTRAINT fg_orden_pago_pkey PRIMARY KEY (id);
--
--
-- --
-- -- Name: fg_pago fg_pago_pkey; Type: CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_pago
--     ADD CONSTRAINT fg_pago_pkey PRIMARY KEY (id);
--
--
-- --
-- -- Name: fg_perfil fg_perfil_pkey; Type: CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_perfil
--     ADD CONSTRAINT fg_perfil_pkey PRIMARY KEY (clave);
--
--
-- --
-- -- Name: fg_perfil_planta fg_perfil_planta_pkey; Type: CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_perfil_planta
--     ADD CONSTRAINT fg_perfil_planta_pkey PRIMARY KEY (perfil_clave, planta_key);
--
--
-- --
-- -- Name: fg_permiso fg_permiso_pkey; Type: CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_permiso
--     ADD CONSTRAINT fg_permiso_pkey PRIMARY KEY (clave);
--
--
-- --
-- -- Name: fg_planta fg_planta_pkey; Type: CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_planta
--     ADD CONSTRAINT fg_planta_pkey PRIMARY KEY (key);
--
--
-- --
-- -- Name: fg_producto_facturacion fg_producto_facturacion_pkey; Type: CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_producto_facturacion
--     ADD CONSTRAINT fg_producto_facturacion_pkey PRIMARY KEY (id);
--
--
-- --
-- -- Name: fg_producto_inventariable fg_producto_inventariable_codigo_key; Type: CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_producto_inventariable
--     ADD CONSTRAINT fg_producto_inventariable_codigo_key UNIQUE (codigo);
--
--
-- --
-- -- Name: fg_producto_inventariable fg_producto_inventariable_pkey; Type: CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_producto_inventariable
--     ADD CONSTRAINT fg_producto_inventariable_pkey PRIMARY KEY (id);
--
--
-- --
-- -- Name: fg_producto_inventariable_sede fg_producto_inventariable_sede_pkey; Type: CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_producto_inventariable_sede
--     ADD CONSTRAINT fg_producto_inventariable_sede_pkey PRIMARY KEY (id);
--
--
-- --
-- -- Name: fg_producto_sede fg_producto_sede_pkey; Type: CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_producto_sede
--     ADD CONSTRAINT fg_producto_sede_pkey PRIMARY KEY (id);
--
--
-- --
-- -- Name: fg_serie_comprobante fg_serie_comprobante_pkey; Type: CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_serie_comprobante
--     ADD CONSTRAINT fg_serie_comprobante_pkey PRIMARY KEY (id);
--
--
-- --
-- -- Name: fg_servicio fg_servicio_codigo_key; Type: CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_servicio
--     ADD CONSTRAINT fg_servicio_codigo_key UNIQUE (codigo);
--
--
-- --
-- -- Name: fg_servicio fg_servicio_pkey; Type: CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_servicio
--     ADD CONSTRAINT fg_servicio_pkey PRIMARY KEY (id);
--
--
-- --
-- -- Name: fg_taller_autorizado fg_taller_autorizado_pkey; Type: CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_taller_autorizado
--     ADD CONSTRAINT fg_taller_autorizado_pkey PRIMARY KEY (id);
--
--
-- --
-- -- Name: fg_tarifa fg_tarifa_pkey; Type: CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_tarifa
--     ADD CONSTRAINT fg_tarifa_pkey PRIMARY KEY (id);
--
--
-- --
-- -- Name: fg_tipo_certificado fg_tipo_certificado_codigo_key; Type: CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_tipo_certificado
--     ADD CONSTRAINT fg_tipo_certificado_codigo_key UNIQUE (codigo);
--
--
-- --
-- -- Name: fg_tipo_certificado fg_tipo_certificado_pkey; Type: CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_tipo_certificado
--     ADD CONSTRAINT fg_tipo_certificado_pkey PRIMARY KEY (clave);
--
--
-- --
-- -- Name: fg_usuario fg_usuario_pkey; Type: CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_usuario
--     ADD CONSTRAINT fg_usuario_pkey PRIMARY KEY (username);
--
--
-- --
-- -- Name: fg_usuario_perfil fg_usuario_perfil_pkey; Type: CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_usuario_perfil
--     ADD CONSTRAINT fg_usuario_perfil_pkey PRIMARY KEY (usuario_username);
--
--
-- --
-- -- Name: fg_usuario_perfil uq_fg_usuario_perfil_documento; Type: CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_usuario_perfil
--     ADD CONSTRAINT uq_fg_usuario_perfil_documento UNIQUE (tipo_documento_key, nro_documento);
--
--
-- --
-- -- Name: fg_usuario_sesion fg_usuario_sesion_pkey; Type: CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_usuario_sesion
--     ADD CONSTRAINT fg_usuario_sesion_pkey PRIMARY KEY (id);
--
--
-- --
-- -- Name: fg_usuario_sesion fg_usuario_sesion_session_jti_key; Type: CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_usuario_sesion
--     ADD CONSTRAINT fg_usuario_sesion_session_jti_key UNIQUE (session_jti);
--
--
-- --
-- -- Name: fg_vehiculo fg_vehiculo_pkey; Type: CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_vehiculo
--     ADD CONSTRAINT fg_vehiculo_pkey PRIMARY KEY (id);
--
--
-- --
-- -- Name: fg_venta_detalle fg_venta_detalle_pkey; Type: CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_venta_detalle
--     ADD CONSTRAINT fg_venta_detalle_pkey PRIMARY KEY (id);
--
--
-- --
-- -- Name: fg_venta fg_venta_pkey; Type: CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_venta
--     ADD CONSTRAINT fg_venta_pkey PRIMARY KEY (id);
--
--
-- --
-- -- Name: fg_perfil_permiso pk_fg_perfil_permiso; Type: CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_perfil_permiso
--     ADD CONSTRAINT pk_fg_perfil_permiso PRIMARY KEY (perfil_clave, permiso_clave);
--
--
-- --
-- -- Name: fg_usuario_planta pk_fg_usuario_planta; Type: CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_usuario_planta
--     ADD CONSTRAINT pk_fg_usuario_planta PRIMARY KEY (usuario_username, plantas_key);
--
--
-- --
-- -- Name: fg_categoria_servicio uk_fg_categoria_servicio_codigo; Type: CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_categoria_servicio
--     ADD CONSTRAINT uk_fg_categoria_servicio_codigo UNIQUE (codigo);
--
--
-- --
-- -- Name: fg_producto_facturacion uk_fg_producto_facturacion_sku; Type: CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_producto_facturacion
--     ADD CONSTRAINT uk_fg_producto_facturacion_sku UNIQUE (codigo_sku);
--
--
-- --
-- -- Name: fg_serie_comprobante uk_fg_serie_comprobante_sede_tipo_serie; Type: CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_serie_comprobante
--     ADD CONSTRAINT uk_fg_serie_comprobante_sede_tipo_serie UNIQUE (planta_key, tipo_comprobante, serie);
--
--
-- --
-- -- Name: fg_tarifa uk_fg_tarifa_planta_codigo; Type: CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_tarifa
--     ADD CONSTRAINT uk_fg_tarifa_planta_codigo UNIQUE (planta_key, codigo);
--
--
-- --
-- -- Name: fg_documento_anulacion uq_fg_anulacion_codigo; Type: CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_documento_anulacion
--     ADD CONSTRAINT uq_fg_anulacion_codigo UNIQUE (codigo_unico);
--
--
-- --
-- -- Name: fg_certificado_chip uq_fg_certificado_chip_chip; Type: CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_certificado_chip
--     ADD CONSTRAINT uq_fg_certificado_chip_chip UNIQUE (chip_id);
--
--
-- --
-- -- Name: fg_empresa_facturador uq_fg_empresa_facturador; Type: CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_empresa_facturador
--     ADD CONSTRAINT uq_fg_empresa_facturador UNIQUE (empresa_key, proveedor, entorno);
--
--
-- --
-- -- Name: fg_empresa_facturador uq_fg_empresa_facturador_credencial; Type: CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_empresa_facturador
--     ADD CONSTRAINT uq_fg_empresa_facturador_credencial UNIQUE (proveedor, entorno, credencial_clave);
--
--
-- --
-- -- Name: fg_facturacion_cuota uq_fg_facturacion_cuota_numero; Type: CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_facturacion_cuota
--     ADD CONSTRAINT uq_fg_facturacion_cuota_numero UNIQUE (facturacion_id, numero_cuota);
--
--
-- --
-- -- Name: fg_facturacion uq_fg_facturacion_emisor_serie_numero; Type: CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_facturacion
--     ADD CONSTRAINT uq_fg_facturacion_emisor_serie_numero UNIQUE (ruc_emisor, entorno_facturador, tipo_comprobante, serie, numero);
--
--
-- --
-- -- Name: fg_facturacion_intento uq_fg_facturacion_intento_numero; Type: CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_facturacion_intento
--     ADD CONSTRAINT uq_fg_facturacion_intento_numero UNIQUE (facturacion_id, numero_intento);
--
--
-- --
-- -- Name: fg_operacion_detalle uq_fg_operacion_detalle_orden; Type: CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_operacion_detalle
--     ADD CONSTRAINT uq_fg_operacion_detalle_orden UNIQUE (operacion_id, orden);
--
--
-- --
-- -- Name: fg_orden_pago uq_fg_orden_pago_certificado; Type: CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_orden_pago
--     ADD CONSTRAINT uq_fg_orden_pago_certificado UNIQUE (certificado_id);
--
--
-- --
-- -- Name: fg_producto_inventariable_sede uq_fg_producto_inventariable_sede; Type: CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_producto_inventariable_sede
--     ADD CONSTRAINT uq_fg_producto_inventariable_sede UNIQUE (producto_inventariable_id, planta_key);
--
--
-- --
-- -- Name: fg_producto_sede uq_fg_producto_sede; Type: CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_producto_sede
--     ADD CONSTRAINT uq_fg_producto_sede UNIQUE (planta_key, producto_facturacion_id);
--
--
-- --
-- -- Name: fg_vehiculo uq_fg_vehiculo_placa_normalizada; Type: CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_vehiculo
--     ADD CONSTRAINT uq_fg_vehiculo_placa_normalizada UNIQUE (placa_normalizada);
--
--
-- --
-- -- Name: fg_correlativo_certificado_activo_idx; Type: INDEX; Schema: public; Owner: -
-- --
--
-- CREATE UNIQUE INDEX fg_correlativo_certificado_activo_idx ON public.fg_correlativo_certificado USING btree (planta_key, tipo_certificado_clave, modalidad) WHERE (activo = true);
--
--
-- --
-- -- Name: fg_inventario_cantidad_movimiento_operacion_idx; Type: INDEX; Schema: public; Owner: -
-- --
--
-- CREATE INDEX fg_inventario_cantidad_movimiento_operacion_idx ON public.fg_inventario_cantidad_movimiento USING btree (operacion_detalle_id) WHERE (operacion_detalle_id IS NOT NULL);
--
--
-- --
-- -- Name: fg_inventario_cantidad_movimiento_stock_idx; Type: INDEX; Schema: public; Owner: -
-- --
--
-- CREATE INDEX fg_inventario_cantidad_movimiento_stock_idx ON public.fg_inventario_cantidad_movimiento USING btree (producto_inventariable_id, planta_key, fecha_creacion, id);
--
--
-- --
-- -- Name: idx_fg_auditoria_acceso_evento; Type: INDEX; Schema: public; Owner: -
-- --
--
-- CREATE INDEX idx_fg_auditoria_acceso_evento ON public.fg_auditoria_acceso USING btree (evento);
--
--
-- --
-- -- Name: idx_fg_auditoria_acceso_fecha_evento; Type: INDEX; Schema: public; Owner: -
-- --
--
-- CREATE INDEX idx_fg_auditoria_acceso_fecha_evento ON public.fg_auditoria_acceso USING btree (fecha_evento);
--
--
-- --
-- -- Name: idx_fg_auditoria_acceso_username; Type: INDEX; Schema: public; Owner: -
-- --
--
-- CREATE INDEX idx_fg_auditoria_acceso_username ON public.fg_auditoria_acceso USING btree (username);
--
--
-- --
-- -- Name: idx_fg_cert_titular_cli; Type: INDEX; Schema: public; Owner: -
-- --
--
-- CREATE INDEX idx_fg_cert_titular_cli ON public.fg_certificado_titular USING btree (cliente_id);
--
--
-- --
-- -- Name: idx_fg_certificado_cli; Type: INDEX; Schema: public; Owner: -
-- --
--
-- CREATE INDEX idx_fg_certificado_cli ON public.fg_certificado USING btree (cliente_id);
--
--
-- --
-- -- Name: idx_fg_certificado_estado; Type: INDEX; Schema: public; Owner: -
-- --
--
-- CREATE INDEX idx_fg_certificado_estado ON public.fg_certificado USING btree (estado);
--
--
-- --
-- -- Name: idx_fg_certificado_fecha; Type: INDEX; Schema: public; Owner: -
-- --
--
-- CREATE INDEX idx_fg_certificado_fecha ON public.fg_certificado USING btree (fecha_emision);
--
--
-- --
-- -- Name: idx_fg_certificado_planta; Type: INDEX; Schema: public; Owner: -
-- --
--
-- CREATE INDEX idx_fg_certificado_planta ON public.fg_certificado USING btree (planta_key);
--
--
-- --
-- -- Name: idx_fg_certificado_tipo; Type: INDEX; Schema: public; Owner: -
-- --
--
-- CREATE INDEX idx_fg_certificado_tipo ON public.fg_certificado USING btree (tipo_certificado_clave);
--
--
-- --
-- -- Name: idx_fg_corr_sede_consumo; Type: INDEX; Schema: public; Owner: -
-- --
--
-- CREATE INDEX idx_fg_corr_sede_consumo ON public.fg_correlativo_certificado_sede USING btree (planta_key) WHERE ((estado)::text = 'ACTIVO'::text);
--
--
-- --
-- -- Name: idx_fg_corr_sede_estado; Type: INDEX; Schema: public; Owner: -
-- --
--
-- CREATE INDEX idx_fg_corr_sede_estado ON public.fg_correlativo_certificado_sede USING btree (estado, fecha_asignacion);
--
--
-- --
-- -- Name: idx_fg_corr_sede_planta; Type: INDEX; Schema: public; Owner: -
-- --
--
-- CREATE INDEX idx_fg_corr_sede_planta ON public.fg_correlativo_certificado_sede USING btree (planta_key, rango_inicio);
--
--
-- --
-- -- Name: idx_fg_correlativo_certificado_listado; Type: INDEX; Schema: public; Owner: -
-- --
--
-- CREATE INDEX idx_fg_correlativo_certificado_listado ON public.fg_correlativo_certificado USING btree (planta_key, tipo_certificado_clave, modalidad, activo);
--
--
-- --
-- -- Name: idx_fg_descom_cert; Type: INDEX; Schema: public; Owner: -
-- --
--
-- CREATE INDEX idx_fg_descom_cert ON public.fg_descuentocomprobante USING btree (certificado_id);
--
--
-- --
-- -- Name: idx_fg_descom_descuento_id; Type: INDEX; Schema: public; Owner: -
-- --
--
-- CREATE INDEX idx_fg_descom_descuento_id ON public.fg_descuentocomprobante USING btree (descuento_id);
--
--
-- --
-- -- Name: idx_fg_descom_descli; Type: INDEX; Schema: public; Owner: -
-- --
--
-- CREATE INDEX idx_fg_descom_descli ON public.fg_descuentocomprobante USING btree (descuento_cliente_id);
--
--
-- --
-- -- Name: idx_fg_descom_estado; Type: INDEX; Schema: public; Owner: -
-- --
--
-- CREATE INDEX idx_fg_descom_estado ON public.fg_descuentocomprobante USING btree (estado);
--
--
-- --
-- -- Name: idx_fg_descuentocliente_doc; Type: INDEX; Schema: public; Owner: -
-- --
--
-- CREATE INDEX idx_fg_descuentocliente_doc ON public.fg_descuentocliente USING btree (nro_documento);
--
--
-- --
-- -- Name: idx_fg_descuentocliente_placa; Type: INDEX; Schema: public; Owner: -
-- --
--
-- CREATE INDEX idx_fg_descuentocliente_placa ON public.fg_descuentocliente USING btree (placa);
--
--
-- --
-- -- Name: idx_fg_descuentocliente_planta; Type: INDEX; Schema: public; Owner: -
-- --
--
-- CREATE INDEX idx_fg_descuentocliente_planta ON public.fg_descuentocliente USING btree (planta_key);
--
--
-- --
-- -- Name: idx_fg_descuentodetalle_codigo; Type: INDEX; Schema: public; Owner: -
-- --
--
-- CREATE INDEX idx_fg_descuentodetalle_codigo ON public.fg_descuentodetalle USING btree (descuento_cliente_id);
--
--
-- --
-- -- Name: idx_fg_descuentodetalle_planta_servicio; Type: INDEX; Schema: public; Owner: -
-- --
--
-- CREATE INDEX idx_fg_descuentodetalle_planta_servicio ON public.fg_descuentodetalle USING btree (planta_key, servicio_id);
--
--
-- --
-- -- Name: idx_fg_empresa_facturador_activo; Type: INDEX; Schema: public; Owner: -
-- --
--
-- CREATE INDEX idx_fg_empresa_facturador_activo ON public.fg_empresa_facturador USING btree (empresa_key, proveedor, entorno, activo);
--
--
-- --
-- -- Name: idx_fg_empresa_listado; Type: INDEX; Schema: public; Owner: -
-- --
--
-- CREATE INDEX idx_fg_empresa_listado ON public.fg_empresa USING btree (activo DESC, nombre);
--
--
-- --
-- -- Name: idx_fg_facturacion_emisor; Type: INDEX; Schema: public; Owner: -
-- --
--
-- CREATE INDEX idx_fg_facturacion_emisor ON public.fg_facturacion USING btree (empresa_key, entorno_facturador, fecha_creacion DESC);
--
--
-- --
-- -- Name: idx_fg_facturacion_estado; Type: INDEX; Schema: public; Owner: -
-- --
--
-- CREATE INDEX idx_fg_facturacion_estado ON public.fg_facturacion USING btree (estado);
--
--
-- --
-- -- Name: idx_fg_facturacion_intento_facturacion; Type: INDEX; Schema: public; Owner: -
-- --
--
-- CREATE INDEX idx_fg_facturacion_intento_facturacion ON public.fg_facturacion_intento USING btree (facturacion_id, numero_intento DESC);
--
--
-- --
-- -- Name: idx_fg_pago_fecha; Type: INDEX; Schema: public; Owner: -
-- --
--
-- CREATE INDEX idx_fg_pago_fecha ON public.fg_pago USING btree (fechacreacion);
--
--
-- --
-- -- Name: idx_fg_pago_orden; Type: INDEX; Schema: public; Owner: -
-- --
--
-- CREATE INDEX idx_fg_pago_orden ON public.fg_pago USING btree (orden_pago_id);
--
--
-- --
-- -- Name: idx_fg_pago_tipo; Type: INDEX; Schema: public; Owner: -
-- --
--
-- CREATE INDEX idx_fg_pago_tipo ON public.fg_pago USING btree (tipocontado_key);
--
--
-- --
-- -- Name: idx_fg_perfil_permiso_perfil; Type: INDEX; Schema: public; Owner: -
-- --
--
-- CREATE INDEX idx_fg_perfil_permiso_perfil ON public.fg_perfil_permiso USING btree (perfil_clave);
--
--
-- --
-- -- Name: idx_fg_perfil_permiso_permiso; Type: INDEX; Schema: public; Owner: -
-- --
--
-- CREATE INDEX idx_fg_perfil_permiso_permiso ON public.fg_perfil_permiso USING btree (permiso_clave);
--
--
-- --
-- -- Name: idx_fg_planta_empresa; Type: INDEX; Schema: public; Owner: -
-- --
--
-- CREATE INDEX idx_fg_planta_empresa ON public.fg_planta USING btree (empresa_key, activo, nombre);
--
--
-- --
-- -- Name: idx_fg_producto_facturacion_categoria; Type: INDEX; Schema: public; Owner: -
-- --
--
-- CREATE INDEX idx_fg_producto_facturacion_categoria ON public.fg_producto_facturacion USING btree (categoria_id, activo);
--
--
-- --
-- -- Name: idx_fg_producto_facturacion_descripcion; Type: INDEX; Schema: public; Owner: -
-- --
--
-- CREATE INDEX idx_fg_producto_facturacion_descripcion ON public.fg_producto_facturacion USING btree (descripcion);
--
--
-- --
-- -- Name: idx_fg_producto_facturacion_filtros; Type: INDEX; Schema: public; Owner: -
-- --
--
-- CREATE INDEX idx_fg_producto_facturacion_filtros ON public.fg_producto_facturacion USING btree (activo, es_para_venta, unidad);
--
--
-- --
-- -- Name: idx_fg_serie_comprobante_listado; Type: INDEX; Schema: public; Owner: -
-- --
--
-- CREATE INDEX idx_fg_serie_comprobante_listado ON public.fg_serie_comprobante USING btree (planta_key, tipo_comprobante, activo);
--
--
-- --
-- -- Name: idx_fg_servicio_categoria; Type: INDEX; Schema: public; Owner: -
-- --
--
-- CREATE INDEX idx_fg_servicio_categoria ON public.fg_servicio USING btree (categoria_id);
--
--
-- --
-- -- Name: idx_fg_tarifa_producto_facturacion; Type: INDEX; Schema: public; Owner: -
-- --
--
-- CREATE INDEX idx_fg_tarifa_producto_facturacion ON public.fg_tarifa USING btree (producto_facturacion_id);
--
--
-- --
-- -- Name: idx_fg_tarifa_servicio; Type: INDEX; Schema: public; Owner: -
-- --
--
-- CREATE INDEX idx_fg_tarifa_servicio ON public.fg_tarifa USING btree (servicio_id);
--
--
-- --
-- -- Name: idx_fg_usuario_persona_nrodocumento; Type: INDEX; Schema: public; Owner: -
-- --
--
-- CREATE INDEX idx_fg_usuario_persona_nrodocumento ON public.fg_usuario USING btree (persona_nrodocumentoidentidad) WHERE (persona_nrodocumentoidentidad IS NOT NULL);
--
--
-- --
-- -- Name: idx_fg_usuario_perfil_nombre; Type: INDEX; Schema: public; Owner: -
-- --
--
-- CREATE INDEX idx_fg_usuario_perfil_nombre ON public.fg_usuario_perfil USING btree (nombre_razon_social, apellidos, nombres);
--
--
-- --
-- -- Name: idx_fg_usuario_sesion_user_active; Type: INDEX; Schema: public; Owner: -
-- --
--
-- CREATE INDEX idx_fg_usuario_sesion_user_active ON public.fg_usuario_sesion USING btree (usuario_username, isactive);
--
--
-- --
-- -- Name: idx_fg_vehiculo_numero_motor; Type: INDEX; Schema: public; Owner: -
-- --
--
-- CREATE INDEX idx_fg_vehiculo_numero_motor ON public.fg_vehiculo USING btree (upper((numero_motor)::text)) WHERE (numero_motor IS NOT NULL);
--
--
-- --
-- -- Name: idx_fg_vehiculo_vin; Type: INDEX; Schema: public; Owner: -
-- --
--
-- CREATE INDEX idx_fg_vehiculo_vin ON public.fg_vehiculo USING btree (upper((vin)::text)) WHERE (vin IS NOT NULL);
--
--
-- --
-- -- Name: ix_fg_auditoria_categoria_fecha; Type: INDEX; Schema: public; Owner: -
-- --
--
-- CREATE INDEX ix_fg_auditoria_categoria_fecha ON public.fg_auditoria_acceso USING btree (categoria, fecha_evento DESC);
--
--
-- --
-- -- Name: ix_fg_auditoria_certificado; Type: INDEX; Schema: public; Owner: -
-- --
--
-- CREATE INDEX ix_fg_auditoria_certificado ON public.fg_auditoria_acceso USING btree (certificado_id, fecha_evento DESC) WHERE (certificado_id IS NOT NULL);
--
--
-- --
-- -- Name: ix_fg_auditoria_placa; Type: INDEX; Schema: public; Owner: -
-- --
--
-- CREATE INDEX ix_fg_auditoria_placa ON public.fg_auditoria_acceso USING btree (placa, fecha_evento DESC) WHERE (placa IS NOT NULL);
--
--
-- --
-- -- Name: ix_fg_certificado_borradores_panel; Type: INDEX; Schema: public; Owner: -
-- --
--
-- CREATE INDEX ix_fg_certificado_borradores_panel ON public.fg_certificado USING btree (planta_key, estado, fecha_modificacion DESC, id DESC);
--
--
-- --
-- -- Name: ix_fg_certificado_panel_fecha_creacion; Type: INDEX; Schema: public; Owner: -
-- --
--
-- CREATE INDEX ix_fg_certificado_panel_fecha_creacion ON public.fg_certificado USING btree (planta_key, estado, fecha_creacion DESC, id DESC);
--
--
-- --
-- -- Name: ix_fg_chip_movimiento_chip; Type: INDEX; Schema: public; Owner: -
-- --
--
-- CREATE INDEX ix_fg_chip_movimiento_chip ON public.fg_chip_movimiento USING btree (chip_id, fecha DESC, id DESC);
--
--
-- --
-- -- Name: ix_fg_chip_stock; Type: INDEX; Schema: public; Owner: -
-- --
--
-- CREATE INDEX ix_fg_chip_stock ON public.fg_chip USING btree (planta_actual_key, estado, producto_inventariable_id);
--
--
-- --
-- -- Name: ix_fg_credito_facturacion; Type: INDEX; Schema: public; Owner: -
-- --
--
-- CREATE INDEX ix_fg_credito_facturacion ON public.fg_credito USING btree (facturacion_id, fecha_creacion DESC);
--
--
-- --
-- -- Name: ix_fg_debito_facturacion; Type: INDEX; Schema: public; Owner: -
-- --
--
-- CREATE INDEX ix_fg_debito_facturacion ON public.fg_debito USING btree (facturacion_id, fecha_creacion DESC);
--
--
-- --
-- -- Name: ix_fg_descuento_ejecutivo; Type: INDEX; Schema: public; Owner: -
-- --
--
-- CREATE INDEX ix_fg_descuento_ejecutivo ON public.fg_descuento USING btree (ejecutivo_id) WHERE (ejecutivo_id IS NOT NULL);
--
--
-- --
-- -- Name: ix_fg_doc_operacion_anulacion; Type: INDEX; Schema: public; Owner: -
-- --
--
-- CREATE INDEX ix_fg_doc_operacion_anulacion ON public.fg_documento_electronico_operacion USING btree (anulacion_id, fecha_creacion DESC);
--
--
-- --
-- -- Name: ix_fg_doc_operacion_credito; Type: INDEX; Schema: public; Owner: -
-- --
--
-- CREATE INDEX ix_fg_doc_operacion_credito ON public.fg_documento_electronico_operacion USING btree (credito_id, fecha_creacion DESC);
--
--
-- --
-- -- Name: ix_fg_doc_operacion_debito; Type: INDEX; Schema: public; Owner: -
-- --
--
-- CREATE INDEX ix_fg_doc_operacion_debito ON public.fg_documento_electronico_operacion USING btree (debito_id, fecha_creacion DESC);
--
--
-- --
-- -- Name: ix_fg_doc_operacion_facturacion; Type: INDEX; Schema: public; Owner: -
-- --
--
-- CREATE INDEX ix_fg_doc_operacion_facturacion ON public.fg_documento_electronico_operacion USING btree (facturacion_id, fecha_creacion DESC);
--
--
-- --
-- -- Name: ix_fg_facturacion_cuota_vencimiento; Type: INDEX; Schema: public; Owner: -
-- --
--
-- CREATE INDEX ix_fg_facturacion_cuota_vencimiento ON public.fg_facturacion_cuota USING btree (facturacion_id, fecha_pago, numero_cuota);
--
--
-- --
-- -- Name: ix_fg_facturacion_pendiente_monitoreo; Type: INDEX; Schema: public; Owner: -
-- --
--
-- CREATE INDEX ix_fg_facturacion_pendiente_monitoreo ON public.fg_facturacion USING btree (estado, fecha_ultimo_intento) WHERE ((estado)::text = ANY ((ARRAY['PENDIENTE'::character varying, 'ERROR'::character varying, 'RECHAZADO'::character varying])::text[]));
--
--
-- --
-- -- Name: ix_fg_operacion_detalle_operacion; Type: INDEX; Schema: public; Owner: -
-- --
--
-- CREATE INDEX ix_fg_operacion_detalle_operacion ON public.fg_operacion_detalle USING btree (operacion_id, orden);
--
--
-- --
-- -- Name: ix_fg_operacion_panel; Type: INDEX; Schema: public; Owner: -
-- --
--
-- CREATE INDEX ix_fg_operacion_panel ON public.fg_operacion_comercial USING btree (planta_key, estado, fecha_creacion DESC, id DESC);
--
--
-- --
-- -- Name: ix_fg_producto_inventariable_sede_producto_fiscal; Type: INDEX; Schema: public; Owner: -
-- --
--
-- CREATE INDEX ix_fg_producto_inventariable_sede_producto_fiscal ON public.fg_producto_inventariable_sede USING btree (producto_facturacion_id);
--
--
-- --
-- -- Name: ix_fg_producto_sede_catalogo; Type: INDEX; Schema: public; Owner: -
-- --
--
-- CREATE INDEX ix_fg_producto_sede_catalogo ON public.fg_producto_sede USING btree (planta_key, activo, orden, producto_facturacion_id);
--
--
-- --
-- -- Name: ix_fg_usuario_sesion_planta_key; Type: INDEX; Schema: public; Owner: -
-- --
--
-- CREATE INDEX ix_fg_usuario_sesion_planta_key ON public.fg_usuario_sesion USING btree (planta_key) WHERE (planta_key IS NOT NULL);
--
--
-- --
-- -- Name: uk_fg_corr_sede_activo; Type: INDEX; Schema: public; Owner: -
-- --
--
-- CREATE UNIQUE INDEX uk_fg_corr_sede_activo ON public.fg_correlativo_certificado_sede USING btree (planta_key) WHERE ((estado)::text = 'ACTIVO'::text);
--
--
-- --
-- -- Name: uk_fg_serie_comprobante_predeterminada_activa; Type: INDEX; Schema: public; Owner: -
-- --
--
-- CREATE UNIQUE INDEX uk_fg_serie_comprobante_predeterminada_activa ON public.fg_serie_comprobante USING btree (planta_key, tipo_comprobante, proveedor_emision, entorno_emision) WHERE ((activo = true) AND (es_predeterminada = true));
--
--
-- --
-- -- Name: uk_fg_tarifa_planta_servicio; Type: INDEX; Schema: public; Owner: -
-- --
--
-- CREATE UNIQUE INDEX uk_fg_tarifa_planta_servicio ON public.fg_tarifa USING btree (planta_key, servicio_id);
--
--
-- --
-- -- Name: uq_fg_anulacion_credito_activa; Type: INDEX; Schema: public; Owner: -
-- --
--
-- CREATE UNIQUE INDEX uq_fg_anulacion_credito_activa ON public.fg_documento_anulacion USING btree (credito_id) WHERE ((credito_id IS NOT NULL) AND ((estado)::text = ANY ((ARRAY['BORRADOR'::character varying, 'PENDIENTE'::character varying, 'ACEPTADO'::character varying])::text[])));
--
--
-- --
-- -- Name: uq_fg_anulacion_debito_activa; Type: INDEX; Schema: public; Owner: -
-- --
--
-- CREATE UNIQUE INDEX uq_fg_anulacion_debito_activa ON public.fg_documento_anulacion USING btree (debito_id) WHERE ((debito_id IS NOT NULL) AND ((estado)::text = ANY ((ARRAY['BORRADOR'::character varying, 'PENDIENTE'::character varying, 'ACEPTADO'::character varying])::text[])));
--
--
-- --
-- -- Name: uq_fg_anulacion_facturacion_activa; Type: INDEX; Schema: public; Owner: -
-- --
--
-- CREATE UNIQUE INDEX uq_fg_anulacion_facturacion_activa ON public.fg_documento_anulacion USING btree (facturacion_id) WHERE ((facturacion_id IS NOT NULL) AND ((estado)::text = ANY ((ARRAY['BORRADOR'::character varying, 'PENDIENTE'::character varying, 'ACEPTADO'::character varying])::text[])));
--
--
-- --
-- -- Name: uq_fg_credito_proveedor_codigo_unico; Type: INDEX; Schema: public; Owner: -
-- --
--
-- CREATE UNIQUE INDEX uq_fg_credito_proveedor_codigo_unico ON public.fg_credito USING btree (proveedor, codigo_unico) WHERE (codigo_unico IS NOT NULL);
--
--
-- --
-- -- Name: uq_fg_credito_serie_numero; Type: INDEX; Schema: public; Owner: -
-- --
--
-- CREATE UNIQUE INDEX uq_fg_credito_serie_numero ON public.fg_credito USING btree (planta_key, serie, numero) WHERE ((serie IS NOT NULL) AND (numero IS NOT NULL));
--
--
-- --
-- -- Name: uq_fg_debito_proveedor_codigo_unico; Type: INDEX; Schema: public; Owner: -
-- --
--
-- CREATE UNIQUE INDEX uq_fg_debito_proveedor_codigo_unico ON public.fg_debito USING btree (proveedor, codigo_unico) WHERE (codigo_unico IS NOT NULL);
--
--
-- --
-- -- Name: uq_fg_debito_serie_numero; Type: INDEX; Schema: public; Owner: -
-- --
--
-- CREATE UNIQUE INDEX uq_fg_debito_serie_numero ON public.fg_debito USING btree (planta_key, serie, numero) WHERE ((serie IS NOT NULL) AND (numero IS NOT NULL));
--
--
-- --
-- -- Name: uq_fg_descom_certificado_activo; Type: INDEX; Schema: public; Owner: -
-- --
--
-- CREATE UNIQUE INDEX uq_fg_descom_certificado_activo ON public.fg_descuentocomprobante USING btree (certificado_id) WHERE ((estado)::text = ANY ((ARRAY['RESERVADO'::character varying, 'APLICADO'::character varying])::text[]));
--
--
-- --
-- -- Name: uq_fg_descuento_codigo_upper; Type: INDEX; Schema: public; Owner: -
-- --
--
-- CREATE UNIQUE INDEX uq_fg_descuento_codigo_upper ON public.fg_descuento USING btree (upper(btrim((codigo)::text)));
--
--
-- --
-- -- Name: uq_fg_descuentocliente_codigo_upper; Type: INDEX; Schema: public; Owner: -
-- --
--
-- CREATE UNIQUE INDEX uq_fg_descuentocliente_codigo_upper ON public.fg_descuentocliente USING btree (upper(btrim((codigo)::text)));
--
--
-- --
-- -- Name: uq_fg_descuentodetalle_descuento_sede_servicio; Type: INDEX; Schema: public; Owner: -
-- --
--
-- CREATE UNIQUE INDEX uq_fg_descuentodetalle_descuento_sede_servicio ON public.fg_descuentodetalle USING btree (descuento_id, planta_key, servicio_id) WHERE (descuento_cliente_id IS NULL);
--
--
-- --
-- -- Name: uq_fg_ejecutivo_nombre; Type: INDEX; Schema: public; Owner: -
-- --
--
-- CREATE UNIQUE INDEX uq_fg_ejecutivo_nombre ON public.fg_ejecutivo USING btree (lower(btrim((nombre)::text)));
--
--
-- --
-- -- Name: uq_fg_empresa_ruc; Type: INDEX; Schema: public; Owner: -
-- --
--
-- CREATE UNIQUE INDEX uq_fg_empresa_ruc ON public.fg_empresa USING btree (ruc) WHERE (ruc IS NOT NULL);
--
--
-- --
-- -- Name: uq_fg_facturacion_operacion; Type: INDEX; Schema: public; Owner: -
-- --
--
-- CREATE UNIQUE INDEX uq_fg_facturacion_operacion ON public.fg_facturacion USING btree (operacion_id) WHERE (operacion_id IS NOT NULL);
--
--
-- --
-- -- Name: uq_fg_facturacion_proveedor_codigo_unico; Type: INDEX; Schema: public; Owner: -
-- --
--
-- CREATE UNIQUE INDEX uq_fg_facturacion_proveedor_codigo_unico ON public.fg_facturacion USING btree (proveedor, codigo_unico) WHERE (codigo_unico IS NOT NULL);
--
--
-- --
-- -- Name: uq_fg_operacion_detalle_certificado; Type: INDEX; Schema: public; Owner: -
-- --
--
-- CREATE UNIQUE INDEX uq_fg_operacion_detalle_certificado ON public.fg_operacion_detalle USING btree (certificado_id) WHERE (certificado_id IS NOT NULL);
--
--
-- --
-- -- Name: uq_fg_orden_pago_operacion; Type: INDEX; Schema: public; Owner: -
-- --
--
-- CREATE UNIQUE INDEX uq_fg_orden_pago_operacion ON public.fg_orden_pago USING btree (operacion_id) WHERE (operacion_id IS NOT NULL);
--
--
-- --
-- -- Name: uq_fg_serie_nubefact_demo_emisor_tipo; Type: INDEX; Schema: public; Owner: -
-- --
--
-- CREATE UNIQUE INDEX uq_fg_serie_nubefact_demo_emisor_tipo ON public.fg_serie_comprobante USING btree (empresa_key, tipo_comprobante, entorno_emision) WHERE (((proveedor_emision)::text = 'NUBEFACT'::text) AND ((entorno_emision)::text = 'DEMO'::text) AND (activo = true) AND (es_predeterminada = true));
--
--
-- --
-- -- Name: uq_fg_serie_nubefact_empresa_documento; Type: INDEX; Schema: public; Owner: -
-- --
--
-- CREATE UNIQUE INDEX uq_fg_serie_nubefact_empresa_documento ON public.fg_serie_comprobante USING btree (empresa_key, tipo_comprobante, serie) WHERE ((proveedor_emision)::text = 'NUBEFACT'::text);
--
--
-- --
-- -- Name: uq_fg_taller_autorizado_planta; Type: INDEX; Schema: public; Owner: -
-- --
--
-- CREATE UNIQUE INDEX uq_fg_taller_autorizado_planta ON public.fg_taller_autorizado USING btree (planta_key) WHERE (planta_key IS NOT NULL);
--
--
-- --
-- -- Name: fg_inventario_cantidad_movimiento fg_inventario_cantidad_movimiento_inmutable; Type: TRIGGER; Schema: public; Owner: -
-- --
--
-- CREATE TRIGGER fg_inventario_cantidad_movimiento_inmutable BEFORE DELETE OR UPDATE ON public.fg_inventario_cantidad_movimiento FOR EACH ROW EXECUTE FUNCTION public.fg_bloquear_mutacion_movimiento_inventario_cantidad();
--
--
-- --
-- -- Name: fg_certificado_chip fg_certificado_chip_certificado_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_certificado_chip
--     ADD CONSTRAINT fg_certificado_chip_certificado_id_fkey FOREIGN KEY (certificado_id) REFERENCES public.fg_certificado(id) ON UPDATE CASCADE ON DELETE RESTRICT;
--
--
-- --
-- -- Name: fg_certificado_chip fg_certificado_chip_chip_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_certificado_chip
--     ADD CONSTRAINT fg_certificado_chip_chip_id_fkey FOREIGN KEY (chip_id) REFERENCES public.fg_chip(id) ON UPDATE CASCADE ON DELETE RESTRICT;
--
--
-- --
-- -- Name: fg_certificado_formato fg_certificado_formato_formato_padre_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_certificado_formato
--     ADD CONSTRAINT fg_certificado_formato_formato_padre_id_fkey FOREIGN KEY (formato_padre_id) REFERENCES public.fg_certificado_formato(id);
--
--
-- --
-- -- Name: fg_certificado_formato_version fg_certificado_formato_version_formato_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_certificado_formato_version
--     ADD CONSTRAINT fg_certificado_formato_version_formato_id_fkey FOREIGN KEY (formato_id) REFERENCES public.fg_certificado_formato(id) ON DELETE CASCADE;
--
--
-- --
-- -- Name: fg_certificado fg_certificado_formato_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_certificado
--     ADD CONSTRAINT fg_certificado_formato_version_id_fkey FOREIGN KEY (formato_version_id) REFERENCES public.fg_certificado_formato_version(id);
--
--
-- --
-- -- Name: fg_certificado_gnv_componente fg_certificado_gnv_componente_certificado_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_certificado_gnv_componente
--     ADD CONSTRAINT fg_certificado_gnv_componente_certificado_id_fkey FOREIGN KEY (certificado_id) REFERENCES public.fg_certificado_gnv(certificado_id) ON DELETE CASCADE;
--
--
-- --
-- -- Name: fg_certificado fg_certificado_producto_chip_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_certificado
--     ADD CONSTRAINT fg_certificado_producto_chip_id_fkey FOREIGN KEY (producto_chip_id) REFERENCES public.fg_producto_inventariable(id) ON DELETE RESTRICT;
--
--
-- --
-- -- Name: fg_certificado fg_certificado_producto_facturacion_certificado_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_certificado
--     ADD CONSTRAINT fg_certificado_producto_facturacion_certificado_id_fkey FOREIGN KEY (producto_facturacion_certificado_id) REFERENCES public.fg_producto_facturacion(id) ON DELETE RESTRICT;
--
--
-- --
-- -- Name: fg_certificado fg_certificado_producto_facturacion_chip_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_certificado
--     ADD CONSTRAINT fg_certificado_producto_facturacion_chip_id_fkey FOREIGN KEY (producto_facturacion_chip_id) REFERENCES public.fg_producto_facturacion(id) ON DELETE RESTRICT;
--
--
-- --
-- -- Name: fg_chip fg_chip_actualizado_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_chip
--     ADD CONSTRAINT fg_chip_actualizado_por_fkey FOREIGN KEY (actualizado_por) REFERENCES public.fg_usuario(username) ON UPDATE CASCADE ON DELETE RESTRICT;
--
--
-- --
-- -- Name: fg_chip fg_chip_creado_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_chip
--     ADD CONSTRAINT fg_chip_creado_por_fkey FOREIGN KEY (creado_por) REFERENCES public.fg_usuario(username) ON UPDATE CASCADE ON DELETE RESTRICT;
--
--
-- --
-- -- Name: fg_chip_movimiento fg_chip_movimiento_certificado_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_chip_movimiento
--     ADD CONSTRAINT fg_chip_movimiento_certificado_id_fkey FOREIGN KEY (certificado_id) REFERENCES public.fg_certificado(id) ON UPDATE CASCADE ON DELETE RESTRICT;
--
--
-- --
-- -- Name: fg_chip_movimiento fg_chip_movimiento_chip_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_chip_movimiento
--     ADD CONSTRAINT fg_chip_movimiento_chip_id_fkey FOREIGN KEY (chip_id) REFERENCES public.fg_chip(id) ON UPDATE CASCADE ON DELETE RESTRICT;
--
--
-- --
-- -- Name: fg_chip_movimiento fg_chip_movimiento_operacion_comercial_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_chip_movimiento
--     ADD CONSTRAINT fg_chip_movimiento_operacion_comercial_id_fkey FOREIGN KEY (operacion_comercial_id) REFERENCES public.fg_operacion_comercial(id) ON UPDATE CASCADE ON DELETE RESTRICT;
--
--
-- --
-- -- Name: fg_chip_movimiento fg_chip_movimiento_planta_destino_key_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_chip_movimiento
--     ADD CONSTRAINT fg_chip_movimiento_planta_destino_key_fkey FOREIGN KEY (planta_destino_key) REFERENCES public.fg_planta(key) ON UPDATE CASCADE ON DELETE RESTRICT;
--
--
-- --
-- -- Name: fg_chip_movimiento fg_chip_movimiento_planta_origen_key_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_chip_movimiento
--     ADD CONSTRAINT fg_chip_movimiento_planta_origen_key_fkey FOREIGN KEY (planta_origen_key) REFERENCES public.fg_planta(key) ON UPDATE CASCADE ON DELETE RESTRICT;
--
--
-- --
-- -- Name: fg_chip_movimiento fg_chip_movimiento_usuario_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_chip_movimiento
--     ADD CONSTRAINT fg_chip_movimiento_usuario_fkey FOREIGN KEY (usuario) REFERENCES public.fg_usuario(username) ON UPDATE CASCADE ON DELETE RESTRICT;
--
--
-- --
-- -- Name: fg_chip fg_chip_operacion_reserva_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_chip
--     ADD CONSTRAINT fg_chip_operacion_reserva_id_fkey FOREIGN KEY (operacion_reserva_id) REFERENCES public.fg_operacion_comercial(id) ON UPDATE CASCADE ON DELETE RESTRICT;
--
--
-- --
-- -- Name: fg_chip fg_chip_planta_actual_key_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_chip
--     ADD CONSTRAINT fg_chip_planta_actual_key_fkey FOREIGN KEY (planta_actual_key) REFERENCES public.fg_planta(key) ON UPDATE CASCADE ON DELETE RESTRICT;
--
--
-- --
-- -- Name: fg_chip fg_chip_producto_inventariable_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_chip
--     ADD CONSTRAINT fg_chip_producto_inventariable_id_fkey FOREIGN KEY (producto_inventariable_id) REFERENCES public.fg_producto_inventariable(id) ON UPDATE CASCADE ON DELETE RESTRICT;
--
--
-- --
-- -- Name: fg_correlativo_certificado_sede fg_correlativo_certificado_sede_planta_key_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_correlativo_certificado_sede
--     ADD CONSTRAINT fg_correlativo_certificado_sede_planta_key_fkey FOREIGN KEY (planta_key) REFERENCES public.fg_planta(key);
--
--
-- --
-- -- Name: fg_facturacion fg_facturacion_venta_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_facturacion
--     ADD CONSTRAINT fg_facturacion_venta_id_fkey FOREIGN KEY (venta_id) REFERENCES public.fg_venta(id);
--
--
-- --
-- -- Name: fg_inventario_cantidad_movimiento fg_inventario_cantidad_movimient_producto_inventariable_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_inventario_cantidad_movimiento
--     ADD CONSTRAINT fg_inventario_cantidad_movimient_producto_inventariable_id_fkey FOREIGN KEY (producto_inventariable_id) REFERENCES public.fg_producto_inventariable(id) ON DELETE RESTRICT;
--
--
-- --
-- -- Name: fg_inventario_cantidad_movimiento fg_inventario_cantidad_movimiento_operacion_detalle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_inventario_cantidad_movimiento
--     ADD CONSTRAINT fg_inventario_cantidad_movimiento_operacion_detalle_id_fkey FOREIGN KEY (operacion_detalle_id) REFERENCES public.fg_operacion_detalle(id) ON DELETE RESTRICT;
--
--
-- --
-- -- Name: fg_inventario_cantidad_movimiento fg_inventario_cantidad_movimiento_planta_key_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_inventario_cantidad_movimiento
--     ADD CONSTRAINT fg_inventario_cantidad_movimiento_planta_key_fkey FOREIGN KEY (planta_key) REFERENCES public.fg_planta(key) ON DELETE RESTRICT;
--
--
-- --
-- -- Name: fg_inventario_cantidad_movimiento fg_inventario_cantidad_movimiento_usuario_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_inventario_cantidad_movimiento
--     ADD CONSTRAINT fg_inventario_cantidad_movimiento_usuario_fkey FOREIGN KEY (usuario) REFERENCES public.fg_usuario(username) ON UPDATE CASCADE ON DELETE RESTRICT;
--
--
-- --
-- -- Name: fg_operacion_detalle_chip fg_operacion_detalle_chip_chip_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_operacion_detalle_chip
--     ADD CONSTRAINT fg_operacion_detalle_chip_chip_id_fkey FOREIGN KEY (chip_id) REFERENCES public.fg_chip(id) ON UPDATE CASCADE ON DELETE RESTRICT;
--
--
-- --
-- -- Name: fg_operacion_detalle_chip fg_operacion_detalle_chip_operacion_detalle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_operacion_detalle_chip
--     ADD CONSTRAINT fg_operacion_detalle_chip_operacion_detalle_id_fkey FOREIGN KEY (operacion_detalle_id) REFERENCES public.fg_operacion_detalle(id) ON UPDATE CASCADE ON DELETE CASCADE;
--
--
-- --
-- -- Name: fg_orden_pago fg_orden_pago_venta_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_orden_pago
--     ADD CONSTRAINT fg_orden_pago_venta_id_fkey FOREIGN KEY (venta_id) REFERENCES public.fg_venta(id);
--
--
-- --
-- -- Name: fg_perfil_planta fg_perfil_planta_perfil_clave_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_perfil_planta
--     ADD CONSTRAINT fg_perfil_planta_perfil_clave_fkey FOREIGN KEY (perfil_clave) REFERENCES public.fg_perfil(clave);
--
--
-- --
-- -- Name: fg_perfil_planta fg_perfil_planta_planta_key_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_perfil_planta
--     ADD CONSTRAINT fg_perfil_planta_planta_key_fkey FOREIGN KEY (planta_key) REFERENCES public.fg_planta(key);
--
--
-- --
-- -- Name: fg_producto_inventariable fg_producto_inventariable_producto_facturacion_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_producto_inventariable
--     ADD CONSTRAINT fg_producto_inventariable_producto_facturacion_id_fkey FOREIGN KEY (producto_facturacion_id) REFERENCES public.fg_producto_facturacion(id) ON UPDATE CASCADE ON DELETE RESTRICT;
--
--
-- --
-- -- Name: fg_producto_inventariable_sede fg_producto_inventariable_sede_planta_key_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_producto_inventariable_sede
--     ADD CONSTRAINT fg_producto_inventariable_sede_planta_key_fkey FOREIGN KEY (planta_key) REFERENCES public.fg_planta(key) ON UPDATE CASCADE ON DELETE RESTRICT;
--
--
-- --
-- -- Name: fg_producto_inventariable_sede fg_producto_inventariable_sede_producto_inventariable_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_producto_inventariable_sede
--     ADD CONSTRAINT fg_producto_inventariable_sede_producto_inventariable_id_fkey FOREIGN KEY (producto_inventariable_id) REFERENCES public.fg_producto_inventariable(id) ON UPDATE CASCADE ON DELETE RESTRICT;
--
--
-- --
-- -- Name: fg_servicio fg_servicio_formato_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_servicio
--     ADD CONSTRAINT fg_servicio_formato_id_fkey FOREIGN KEY (formato_id) REFERENCES public.fg_certificado_formato(id);
--
--
-- --
-- -- Name: fg_servicio fg_servicio_tipo_certificado_clave_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_servicio
--     ADD CONSTRAINT fg_servicio_tipo_certificado_clave_fkey FOREIGN KEY (tipo_certificado_clave) REFERENCES public.fg_tipo_certificado(clave);
--
--
-- --
-- -- Name: fg_venta_detalle fg_venta_detalle_chip_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_venta_detalle
--     ADD CONSTRAINT fg_venta_detalle_chip_id_fkey FOREIGN KEY (chip_id) REFERENCES public.fg_chip(id);
--
--
-- --
-- -- Name: fg_venta_detalle fg_venta_detalle_producto_inventariable_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_venta_detalle
--     ADD CONSTRAINT fg_venta_detalle_producto_inventariable_id_fkey FOREIGN KEY (producto_inventariable_id) REFERENCES public.fg_producto_inventariable(id);
--
--
-- --
-- -- Name: fg_venta_detalle fg_venta_detalle_venta_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_venta_detalle
--     ADD CONSTRAINT fg_venta_detalle_venta_id_fkey FOREIGN KEY (venta_id) REFERENCES public.fg_venta(id) ON DELETE CASCADE;
--
--
-- --
-- -- Name: fg_auditoria_config fk_auditoria_usuario; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_auditoria_config
--     ADD CONSTRAINT fk_auditoria_usuario FOREIGN KEY (username) REFERENCES public.fg_usuario(username);
--
--
-- --
-- -- Name: fg_certificado_conformidad fk_cert_conf_cert; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_certificado_conformidad
--     ADD CONSTRAINT fk_cert_conf_cert FOREIGN KEY (certificado_id) REFERENCES public.fg_certificado(id) ON UPDATE CASCADE ON DELETE CASCADE;
--
--
-- --
-- -- Name: fg_certificado_glp fk_cert_glp_cert; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_certificado_glp
--     ADD CONSTRAINT fk_cert_glp_cert FOREIGN KEY (certificado_id) REFERENCES public.fg_certificado(id) ON UPDATE CASCADE ON DELETE CASCADE;
--
--
-- --
-- -- Name: fg_certificado_glp_componente fk_cert_glp_comp_cert; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_certificado_glp_componente
--     ADD CONSTRAINT fk_cert_glp_comp_cert FOREIGN KEY (certificado_id) REFERENCES public.fg_certificado_glp(certificado_id) ON UPDATE CASCADE ON DELETE CASCADE;
--
--
-- --
-- -- Name: fg_certificado_glp fk_cert_glp_taller; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_certificado_glp
--     ADD CONSTRAINT fk_cert_glp_taller FOREIGN KEY (taller_autorizado_id) REFERENCES public.fg_taller_autorizado(id) ON UPDATE CASCADE;
--
--
-- --
-- -- Name: fg_certificado_glp_verificacion fk_cert_glp_verif_cert; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_certificado_glp_verificacion
--     ADD CONSTRAINT fk_cert_glp_verif_cert FOREIGN KEY (certificado_id) REFERENCES public.fg_certificado_glp(certificado_id) ON UPDATE CASCADE ON DELETE CASCADE;
--
--
-- --
-- -- Name: fg_certificado_gnv fk_cert_gnv_cert; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_certificado_gnv
--     ADD CONSTRAINT fk_cert_gnv_cert FOREIGN KEY (certificado_id) REFERENCES public.fg_certificado(id) ON UPDATE CASCADE ON DELETE CASCADE;
--
--
-- --
-- -- Name: fg_certificado_gnv fk_cert_gnv_taller; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_certificado_gnv
--     ADD CONSTRAINT fk_cert_gnv_taller FOREIGN KEY (taller_autorizado_id) REFERENCES public.fg_taller_autorizado(id) ON UPDATE CASCADE;
--
--
-- --
-- -- Name: fg_certificado_gnv_verificacion fk_cert_gnv_verif_cert; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_certificado_gnv_verificacion
--     ADD CONSTRAINT fk_cert_gnv_verif_cert FOREIGN KEY (certificado_id) REFERENCES public.fg_certificado_gnv(certificado_id) ON UPDATE CASCADE ON DELETE CASCADE;
--
--
-- --
-- -- Name: fg_certificado_titular fk_cert_titular_cert; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_certificado_titular
--     ADD CONSTRAINT fk_cert_titular_cert FOREIGN KEY (certificado_id) REFERENCES public.fg_certificado(id) ON UPDATE CASCADE ON DELETE CASCADE;
--
--
-- --
-- -- Name: fg_certificado_titular fk_cert_titular_cliente; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_certificado_titular
--     ADD CONSTRAINT fk_cert_titular_cliente FOREIGN KEY (cliente_id) REFERENCES public.fg_cliente(id) ON UPDATE CASCADE;
--
--
-- --
-- -- Name: fg_certificado_vehiculo fk_cert_vehiculo_cert; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_certificado_vehiculo
--     ADD CONSTRAINT fk_cert_vehiculo_cert FOREIGN KEY (certificado_id) REFERENCES public.fg_certificado(id) ON UPDATE CASCADE ON DELETE CASCADE;
--
--
-- --
-- -- Name: fg_certificado fk_certificado_cliente; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_certificado
--     ADD CONSTRAINT fk_certificado_cliente FOREIGN KEY (cliente_id) REFERENCES public.fg_cliente(id) ON UPDATE CASCADE;
--
--
-- --
-- -- Name: fg_certificado fk_certificado_planta; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_certificado
--     ADD CONSTRAINT fk_certificado_planta FOREIGN KEY (planta_key) REFERENCES public.fg_planta(key) ON UPDATE CASCADE;
--
--
-- --
-- -- Name: fg_certificado fk_certificado_tipo; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_certificado
--     ADD CONSTRAINT fk_certificado_tipo FOREIGN KEY (tipo_certificado_clave) REFERENCES public.fg_tipo_certificado(clave) ON UPDATE CASCADE;
--
--
-- --
-- -- Name: fg_certificado fk_certificado_usuarioc; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_certificado
--     ADD CONSTRAINT fk_certificado_usuarioc FOREIGN KEY (usuario_creacion) REFERENCES public.fg_usuario(username) ON UPDATE CASCADE;
--
--
-- --
-- -- Name: fg_certificado fk_certificado_usuariom; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_certificado
--     ADD CONSTRAINT fk_certificado_usuariom FOREIGN KEY (usuario_modificacion) REFERENCES public.fg_usuario(username) ON UPDATE CASCADE;
--
--
-- --
-- -- Name: fg_correlativo_certificado fk_correlativo_planta; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_correlativo_certificado
--     ADD CONSTRAINT fk_correlativo_planta FOREIGN KEY (planta_key) REFERENCES public.fg_planta(key) ON UPDATE CASCADE;
--
--
-- --
-- -- Name: fg_correlativo_certificado fk_correlativo_tipo; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_correlativo_certificado
--     ADD CONSTRAINT fk_correlativo_tipo FOREIGN KEY (tipo_certificado_clave) REFERENCES public.fg_tipo_certificado(clave) ON UPDATE CASCADE;
--
--
-- --
-- -- Name: fg_documento_anulacion fk_fg_anulacion_credito; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_documento_anulacion
--     ADD CONSTRAINT fk_fg_anulacion_credito FOREIGN KEY (credito_id) REFERENCES public.fg_credito(id) ON UPDATE CASCADE ON DELETE RESTRICT;
--
--
-- --
-- -- Name: fg_documento_anulacion fk_fg_anulacion_debito; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_documento_anulacion
--     ADD CONSTRAINT fk_fg_anulacion_debito FOREIGN KEY (debito_id) REFERENCES public.fg_debito(id) ON UPDATE CASCADE ON DELETE RESTRICT;
--
--
-- --
-- -- Name: fg_documento_anulacion fk_fg_anulacion_facturacion; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_documento_anulacion
--     ADD CONSTRAINT fk_fg_anulacion_facturacion FOREIGN KEY (facturacion_id) REFERENCES public.fg_facturacion(id) ON UPDATE CASCADE ON DELETE RESTRICT;
--
--
-- --
-- -- Name: fg_documento_anulacion fk_fg_anulacion_usuario_creacion; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_documento_anulacion
--     ADD CONSTRAINT fk_fg_anulacion_usuario_creacion FOREIGN KEY (usuario_creacion) REFERENCES public.fg_usuario(username) ON UPDATE CASCADE ON DELETE RESTRICT;
--
--
-- --
-- -- Name: fg_documento_anulacion fk_fg_anulacion_usuario_modificacion; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_documento_anulacion
--     ADD CONSTRAINT fk_fg_anulacion_usuario_modificacion FOREIGN KEY (usuario_modificacion) REFERENCES public.fg_usuario(username) ON UPDATE CASCADE ON DELETE RESTRICT;
--
--
-- --
-- -- Name: fg_certificado_gnv fk_fg_certificado_gnv_taller_planta; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_certificado_gnv
--     ADD CONSTRAINT fk_fg_certificado_gnv_taller_planta FOREIGN KEY (taller_planta_key) REFERENCES public.fg_planta(key) ON UPDATE CASCADE ON DELETE RESTRICT;
--
--
-- --
-- -- Name: fg_credito fk_fg_credito_empresa; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_credito
--     ADD CONSTRAINT fk_fg_credito_empresa FOREIGN KEY (empresa_key) REFERENCES public.fg_empresa(key) ON UPDATE CASCADE ON DELETE RESTRICT;
--
--
-- --
-- -- Name: fg_credito fk_fg_credito_facturacion; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_credito
--     ADD CONSTRAINT fk_fg_credito_facturacion FOREIGN KEY (facturacion_id) REFERENCES public.fg_facturacion(id) ON UPDATE CASCADE ON DELETE RESTRICT;
--
--
-- --
-- -- Name: fg_credito fk_fg_credito_moneda; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_credito
--     ADD CONSTRAINT fk_fg_credito_moneda FOREIGN KEY (moneda_key) REFERENCES public.moneda(key) ON UPDATE CASCADE ON DELETE RESTRICT;
--
--
-- --
-- -- Name: fg_credito fk_fg_credito_planta; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_credito
--     ADD CONSTRAINT fk_fg_credito_planta FOREIGN KEY (planta_key) REFERENCES public.fg_planta(key) ON UPDATE CASCADE ON DELETE RESTRICT;
--
--
-- --
-- -- Name: fg_credito fk_fg_credito_serie; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_credito
--     ADD CONSTRAINT fk_fg_credito_serie FOREIGN KEY (serie_comprobante_id) REFERENCES public.fg_serie_comprobante(id) ON UPDATE CASCADE ON DELETE RESTRICT;
--
--
-- --
-- -- Name: fg_credito fk_fg_credito_usuario_creacion; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_credito
--     ADD CONSTRAINT fk_fg_credito_usuario_creacion FOREIGN KEY (usuario_creacion) REFERENCES public.fg_usuario(username) ON UPDATE CASCADE ON DELETE RESTRICT;
--
--
-- --
-- -- Name: fg_credito fk_fg_credito_usuario_modificacion; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_credito
--     ADD CONSTRAINT fk_fg_credito_usuario_modificacion FOREIGN KEY (usuario_modificacion) REFERENCES public.fg_usuario(username) ON UPDATE CASCADE ON DELETE RESTRICT;
--
--
-- --
-- -- Name: fg_debito fk_fg_debito_empresa; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_debito
--     ADD CONSTRAINT fk_fg_debito_empresa FOREIGN KEY (empresa_key) REFERENCES public.fg_empresa(key) ON UPDATE CASCADE ON DELETE RESTRICT;
--
--
-- --
-- -- Name: fg_debito fk_fg_debito_facturacion; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_debito
--     ADD CONSTRAINT fk_fg_debito_facturacion FOREIGN KEY (facturacion_id) REFERENCES public.fg_facturacion(id) ON UPDATE CASCADE ON DELETE RESTRICT;
--
--
-- --
-- -- Name: fg_debito fk_fg_debito_moneda; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_debito
--     ADD CONSTRAINT fk_fg_debito_moneda FOREIGN KEY (moneda_key) REFERENCES public.moneda(key) ON UPDATE CASCADE ON DELETE RESTRICT;
--
--
-- --
-- -- Name: fg_debito fk_fg_debito_planta; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_debito
--     ADD CONSTRAINT fk_fg_debito_planta FOREIGN KEY (planta_key) REFERENCES public.fg_planta(key) ON UPDATE CASCADE ON DELETE RESTRICT;
--
--
-- --
-- -- Name: fg_debito fk_fg_debito_serie; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_debito
--     ADD CONSTRAINT fk_fg_debito_serie FOREIGN KEY (serie_comprobante_id) REFERENCES public.fg_serie_comprobante(id) ON UPDATE CASCADE ON DELETE RESTRICT;
--
--
-- --
-- -- Name: fg_debito fk_fg_debito_usuario_creacion; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_debito
--     ADD CONSTRAINT fk_fg_debito_usuario_creacion FOREIGN KEY (usuario_creacion) REFERENCES public.fg_usuario(username) ON UPDATE CASCADE ON DELETE RESTRICT;
--
--
-- --
-- -- Name: fg_debito fk_fg_debito_usuario_modificacion; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_debito
--     ADD CONSTRAINT fk_fg_debito_usuario_modificacion FOREIGN KEY (usuario_modificacion) REFERENCES public.fg_usuario(username) ON UPDATE CASCADE ON DELETE RESTRICT;
--
--
-- --
-- -- Name: fg_descuentocomprobante fk_fg_descom_cert; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_descuentocomprobante
--     ADD CONSTRAINT fk_fg_descom_cert FOREIGN KEY (certificado_id) REFERENCES public.fg_certificado(id) ON UPDATE CASCADE ON DELETE RESTRICT;
--
--
-- --
-- -- Name: fg_descuentocomprobante fk_fg_descom_descli; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_descuentocomprobante
--     ADD CONSTRAINT fk_fg_descom_descli FOREIGN KEY (descuento_cliente_id) REFERENCES public.fg_descuentocliente(id) ON UPDATE CASCADE ON DELETE RESTRICT;
--
--
-- --
-- -- Name: fg_descuentocomprobante fk_fg_descom_fact; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_descuentocomprobante
--     ADD CONSTRAINT fk_fg_descom_fact FOREIGN KEY (facturacion_id) REFERENCES public.fg_facturacion(id) ON UPDATE CASCADE ON DELETE RESTRICT;
--
--
-- --
-- -- Name: fg_descuentocomprobante fk_fg_descom_orden; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_descuentocomprobante
--     ADD CONSTRAINT fk_fg_descom_orden FOREIGN KEY (orden_pago_id) REFERENCES public.fg_orden_pago(id) ON UPDATE CASCADE ON DELETE RESTRICT;
--
--
-- --
-- -- Name: fg_descuentocomprobante fk_fg_descom_usu_crea; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_descuentocomprobante
--     ADD CONSTRAINT fk_fg_descom_usu_crea FOREIGN KEY (usuario_creacion) REFERENCES public.fg_usuario(username) ON UPDATE CASCADE ON DELETE RESTRICT;
--
--
-- --
-- -- Name: fg_descuentocomprobante fk_fg_descom_usu_mod; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_descuentocomprobante
--     ADD CONSTRAINT fk_fg_descom_usu_mod FOREIGN KEY (usuario_modificacion) REFERENCES public.fg_usuario(username) ON UPDATE CASCADE ON DELETE RESTRICT;
--
--
-- --
-- -- Name: fg_descuento fk_fg_descuento_ejecutivo; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_descuento
--     ADD CONSTRAINT fk_fg_descuento_ejecutivo FOREIGN KEY (ejecutivo_id) REFERENCES public.fg_ejecutivo(id) ON UPDATE CASCADE;
--
--
-- --
-- -- Name: fg_descuento fk_fg_descuento_planta; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_descuento
--     ADD CONSTRAINT fk_fg_descuento_planta FOREIGN KEY (planta_key) REFERENCES public.fg_planta(key) ON UPDATE CASCADE ON DELETE RESTRICT;
--
--
-- --
-- -- Name: fg_descuento fk_fg_descuento_usu_crea; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_descuento
--     ADD CONSTRAINT fk_fg_descuento_usu_crea FOREIGN KEY (usuario_creacion) REFERENCES public.fg_usuario(username) ON UPDATE CASCADE ON DELETE RESTRICT;
--
--
-- --
-- -- Name: fg_descuento fk_fg_descuento_usu_mod; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_descuento
--     ADD CONSTRAINT fk_fg_descuento_usu_mod FOREIGN KEY (usuario_modificacion) REFERENCES public.fg_usuario(username) ON UPDATE CASCADE ON DELETE RESTRICT;
--
--
-- --
-- -- Name: fg_descuentocliente fk_fg_descuentocliente_descuento; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_descuentocliente
--     ADD CONSTRAINT fk_fg_descuentocliente_descuento FOREIGN KEY (descuento_id) REFERENCES public.fg_descuento(id) ON UPDATE CASCADE ON DELETE CASCADE;
--
--
-- --
-- -- Name: fg_descuentocliente fk_fg_descuentocliente_planta; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_descuentocliente
--     ADD CONSTRAINT fk_fg_descuentocliente_planta FOREIGN KEY (planta_key) REFERENCES public.fg_planta(key) ON UPDATE CASCADE ON DELETE RESTRICT;
--
--
-- --
-- -- Name: fg_descuentocliente fk_fg_descuentocliente_usu_crea; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_descuentocliente
--     ADD CONSTRAINT fk_fg_descuentocliente_usu_crea FOREIGN KEY (usuario_creacion) REFERENCES public.fg_usuario(username) ON UPDATE CASCADE ON DELETE RESTRICT;
--
--
-- --
-- -- Name: fg_descuentocliente fk_fg_descuentocliente_usu_mod; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_descuentocliente
--     ADD CONSTRAINT fk_fg_descuentocliente_usu_mod FOREIGN KEY (usuario_modificacion) REFERENCES public.fg_usuario(username) ON UPDATE CASCADE ON DELETE RESTRICT;
--
--
-- --
-- -- Name: fg_descuentodetalle fk_fg_descuentodetalle_codigo; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_descuentodetalle
--     ADD CONSTRAINT fk_fg_descuentodetalle_codigo FOREIGN KEY (descuento_cliente_id) REFERENCES public.fg_descuentocliente(id) ON UPDATE CASCADE ON DELETE CASCADE;
--
--
-- --
-- -- Name: fg_descuentodetalle fk_fg_descuentodetalle_descuento; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_descuentodetalle
--     ADD CONSTRAINT fk_fg_descuentodetalle_descuento FOREIGN KEY (descuento_id) REFERENCES public.fg_descuento(id) ON UPDATE CASCADE ON DELETE CASCADE;
--
--
-- --
-- -- Name: fg_descuentodetalle fk_fg_descuentodetalle_planta; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_descuentodetalle
--     ADD CONSTRAINT fk_fg_descuentodetalle_planta FOREIGN KEY (planta_key) REFERENCES public.fg_planta(key) ON UPDATE CASCADE ON DELETE RESTRICT;
--
--
-- --
-- -- Name: fg_descuentodetalle fk_fg_descuentodetalle_servicio; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_descuentodetalle
--     ADD CONSTRAINT fk_fg_descuentodetalle_servicio FOREIGN KEY (servicio_id) REFERENCES public.fg_servicio(id) ON UPDATE CASCADE ON DELETE CASCADE;
--
--
-- --
-- -- Name: fg_descuentodetalle fk_fg_descuentodetalle_usu_crea; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_descuentodetalle
--     ADD CONSTRAINT fk_fg_descuentodetalle_usu_crea FOREIGN KEY (usuario_creacion) REFERENCES public.fg_usuario(username) ON UPDATE CASCADE ON DELETE RESTRICT;
--
--
-- --
-- -- Name: fg_descuentodetalle fk_fg_descuentodetalle_usu_mod; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_descuentodetalle
--     ADD CONSTRAINT fk_fg_descuentodetalle_usu_mod FOREIGN KEY (usuario_modificacion) REFERENCES public.fg_usuario(username) ON UPDATE CASCADE ON DELETE RESTRICT;
--
--
-- --
-- -- Name: fg_documento_electronico_operacion fk_fg_doc_operacion_anulacion; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_documento_electronico_operacion
--     ADD CONSTRAINT fk_fg_doc_operacion_anulacion FOREIGN KEY (anulacion_id) REFERENCES public.fg_documento_anulacion(id) ON UPDATE CASCADE ON DELETE CASCADE;
--
--
-- --
-- -- Name: fg_documento_electronico_operacion fk_fg_doc_operacion_credito; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_documento_electronico_operacion
--     ADD CONSTRAINT fk_fg_doc_operacion_credito FOREIGN KEY (credito_id) REFERENCES public.fg_credito(id) ON UPDATE CASCADE ON DELETE CASCADE;
--
--
-- --
-- -- Name: fg_documento_electronico_operacion fk_fg_doc_operacion_debito; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_documento_electronico_operacion
--     ADD CONSTRAINT fk_fg_doc_operacion_debito FOREIGN KEY (debito_id) REFERENCES public.fg_debito(id) ON UPDATE CASCADE ON DELETE CASCADE;
--
--
-- --
-- -- Name: fg_documento_electronico_operacion fk_fg_doc_operacion_facturacion; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_documento_electronico_operacion
--     ADD CONSTRAINT fk_fg_doc_operacion_facturacion FOREIGN KEY (facturacion_id) REFERENCES public.fg_facturacion(id) ON UPDATE CASCADE ON DELETE CASCADE;
--
--
-- --
-- -- Name: fg_documento_electronico_operacion fk_fg_doc_operacion_usuario; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_documento_electronico_operacion
--     ADD CONSTRAINT fk_fg_doc_operacion_usuario FOREIGN KEY (usuario_creacion) REFERENCES public.fg_usuario(username) ON UPDATE CASCADE ON DELETE RESTRICT;
--
--
-- --
-- -- Name: fg_ejecutivo fk_fg_ejecutivo_usu_crea; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_ejecutivo
--     ADD CONSTRAINT fk_fg_ejecutivo_usu_crea FOREIGN KEY (usuario_creacion) REFERENCES public.fg_usuario(username) ON UPDATE CASCADE;
--
--
-- --
-- -- Name: fg_ejecutivo fk_fg_ejecutivo_usu_mod; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_ejecutivo
--     ADD CONSTRAINT fk_fg_ejecutivo_usu_mod FOREIGN KEY (usuario_modificacion) REFERENCES public.fg_usuario(username) ON UPDATE CASCADE;
--
--
-- --
-- -- Name: fg_ejecutivo fk_fg_ejecutivo_usuario; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_ejecutivo
--     ADD CONSTRAINT fk_fg_ejecutivo_usuario FOREIGN KEY (username) REFERENCES public.fg_usuario(username) ON UPDATE CASCADE;
--
--
-- --
-- -- Name: fg_empresa_facturador fk_fg_empresa_facturador_empresa; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_empresa_facturador
--     ADD CONSTRAINT fk_fg_empresa_facturador_empresa FOREIGN KEY (empresa_key) REFERENCES public.fg_empresa(key) ON UPDATE CASCADE ON DELETE RESTRICT;
--
--
-- --
-- -- Name: fg_facturacion fk_fg_facturacion_certificado; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_facturacion
--     ADD CONSTRAINT fk_fg_facturacion_certificado FOREIGN KEY (certificado_id) REFERENCES public.fg_certificado(id) ON UPDATE CASCADE ON DELETE CASCADE;
--
--
-- --
-- -- Name: fg_facturacion_cuota fk_fg_facturacion_cuota_facturacion; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_facturacion_cuota
--     ADD CONSTRAINT fk_fg_facturacion_cuota_facturacion FOREIGN KEY (facturacion_id) REFERENCES public.fg_facturacion(id) ON UPDATE CASCADE ON DELETE CASCADE;
--
--
-- --
-- -- Name: fg_facturacion fk_fg_facturacion_empresa; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_facturacion
--     ADD CONSTRAINT fk_fg_facturacion_empresa FOREIGN KEY (empresa_key) REFERENCES public.fg_empresa(key) ON UPDATE CASCADE ON DELETE RESTRICT;
--
--
-- --
-- -- Name: fg_facturacion_intento fk_fg_facturacion_intento_facturacion; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_facturacion_intento
--     ADD CONSTRAINT fk_fg_facturacion_intento_facturacion FOREIGN KEY (facturacion_id) REFERENCES public.fg_facturacion(id) ON UPDATE CASCADE ON DELETE CASCADE;
--
--
-- --
-- -- Name: fg_facturacion fk_fg_facturacion_moneda; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_facturacion
--     ADD CONSTRAINT fk_fg_facturacion_moneda FOREIGN KEY (moneda_key) REFERENCES public.moneda(key) ON UPDATE CASCADE;
--
--
-- --
-- -- Name: fg_facturacion fk_fg_facturacion_operacion; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_facturacion
--     ADD CONSTRAINT fk_fg_facturacion_operacion FOREIGN KEY (operacion_id) REFERENCES public.fg_operacion_comercial(id) ON UPDATE CASCADE ON DELETE RESTRICT;
--
--
-- --
-- -- Name: fg_facturacion fk_fg_facturacion_planta; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_facturacion
--     ADD CONSTRAINT fk_fg_facturacion_planta FOREIGN KEY (planta_key) REFERENCES public.fg_planta(key) ON UPDATE CASCADE ON DELETE RESTRICT;
--
--
-- --
-- -- Name: fg_facturacion fk_fg_facturacion_serie_comprobante; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_facturacion
--     ADD CONSTRAINT fk_fg_facturacion_serie_comprobante FOREIGN KEY (serie_comprobante_id) REFERENCES public.fg_serie_comprobante(id) ON UPDATE CASCADE ON DELETE RESTRICT;
--
--
-- --
-- -- Name: fg_operacion_comercial fk_fg_operacion_cliente; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_operacion_comercial
--     ADD CONSTRAINT fk_fg_operacion_cliente FOREIGN KEY (cliente_id) REFERENCES public.fg_cliente(id) ON UPDATE CASCADE ON DELETE SET NULL;
--
--
-- --
-- -- Name: fg_operacion_detalle fk_fg_operacion_detalle_certificado; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_operacion_detalle
--     ADD CONSTRAINT fk_fg_operacion_detalle_certificado FOREIGN KEY (certificado_id) REFERENCES public.fg_certificado(id) ON UPDATE CASCADE ON DELETE RESTRICT;
--
--
-- --
-- -- Name: fg_operacion_detalle fk_fg_operacion_detalle_operacion; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_operacion_detalle
--     ADD CONSTRAINT fk_fg_operacion_detalle_operacion FOREIGN KEY (operacion_id) REFERENCES public.fg_operacion_comercial(id) ON UPDATE CASCADE ON DELETE CASCADE;
--
--
-- --
-- -- Name: fg_operacion_detalle fk_fg_operacion_detalle_producto; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_operacion_detalle
--     ADD CONSTRAINT fk_fg_operacion_detalle_producto FOREIGN KEY (producto_facturacion_id) REFERENCES public.fg_producto_facturacion(id) ON UPDATE CASCADE ON DELETE RESTRICT;
--
--
-- --
-- -- Name: fg_operacion_detalle fk_fg_operacion_detalle_servicio; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_operacion_detalle
--     ADD CONSTRAINT fk_fg_operacion_detalle_servicio FOREIGN KEY (servicio_id) REFERENCES public.fg_servicio(id) ON UPDATE CASCADE ON DELETE RESTRICT;
--
--
-- --
-- -- Name: fg_operacion_detalle fk_fg_operacion_detalle_tarifa; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_operacion_detalle
--     ADD CONSTRAINT fk_fg_operacion_detalle_tarifa FOREIGN KEY (tarifa_id) REFERENCES public.fg_tarifa(id) ON UPDATE CASCADE ON DELETE RESTRICT;
--
--
-- --
-- -- Name: fg_operacion_comercial fk_fg_operacion_moneda; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_operacion_comercial
--     ADD CONSTRAINT fk_fg_operacion_moneda FOREIGN KEY (moneda_key) REFERENCES public.moneda(key) ON UPDATE CASCADE ON DELETE RESTRICT;
--
--
-- --
-- -- Name: fg_operacion_comercial fk_fg_operacion_planta; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_operacion_comercial
--     ADD CONSTRAINT fk_fg_operacion_planta FOREIGN KEY (planta_key) REFERENCES public.fg_planta(key) ON UPDATE CASCADE ON DELETE RESTRICT;
--
--
-- --
-- -- Name: fg_operacion_comercial fk_fg_operacion_usuario_creacion; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_operacion_comercial
--     ADD CONSTRAINT fk_fg_operacion_usuario_creacion FOREIGN KEY (usuario_creacion) REFERENCES public.fg_usuario(username) ON UPDATE CASCADE ON DELETE RESTRICT;
--
--
-- --
-- -- Name: fg_operacion_comercial fk_fg_operacion_usuario_modificacion; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_operacion_comercial
--     ADD CONSTRAINT fk_fg_operacion_usuario_modificacion FOREIGN KEY (usuario_modificacion) REFERENCES public.fg_usuario(username) ON UPDATE CASCADE ON DELETE RESTRICT;
--
--
-- --
-- -- Name: fg_orden_pago fk_fg_orden_pago_certificado; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_orden_pago
--     ADD CONSTRAINT fk_fg_orden_pago_certificado FOREIGN KEY (certificado_id) REFERENCES public.fg_certificado(id) ON UPDATE CASCADE ON DELETE CASCADE;
--
--
-- --
-- -- Name: fg_orden_pago fk_fg_orden_pago_formapago; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_orden_pago
--     ADD CONSTRAINT fk_fg_orden_pago_formapago FOREIGN KEY (formapago_key) REFERENCES public.formapago(key) ON UPDATE CASCADE ON DELETE RESTRICT;
--
--
-- --
-- -- Name: fg_orden_pago fk_fg_orden_pago_moneda; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_orden_pago
--     ADD CONSTRAINT fk_fg_orden_pago_moneda FOREIGN KEY (moneda_key) REFERENCES public.moneda(key) ON UPDATE CASCADE ON DELETE RESTRICT;
--
--
-- --
-- -- Name: fg_orden_pago fk_fg_orden_pago_operacion; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_orden_pago
--     ADD CONSTRAINT fk_fg_orden_pago_operacion FOREIGN KEY (operacion_id) REFERENCES public.fg_operacion_comercial(id) ON UPDATE CASCADE ON DELETE RESTRICT;
--
--
-- --
-- -- Name: fg_pago fk_fg_pago_cuenta; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_pago
--     ADD CONSTRAINT fk_fg_pago_cuenta FOREIGN KEY (cuentacorriente_key) REFERENCES public.cuentacorriente(key) ON UPDATE CASCADE ON DELETE RESTRICT;
--
--
-- --
-- -- Name: fg_pago fk_fg_pago_entidad; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_pago
--     ADD CONSTRAINT fk_fg_pago_entidad FOREIGN KEY (entidadfinanciera_key) REFERENCES public.entidadfinanciera(key) ON UPDATE CASCADE ON DELETE RESTRICT;
--
--
-- --
-- -- Name: fg_pago fk_fg_pago_moneda; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_pago
--     ADD CONSTRAINT fk_fg_pago_moneda FOREIGN KEY (moneda_key) REFERENCES public.moneda(key) ON UPDATE CASCADE ON DELETE RESTRICT;
--
--
-- --
-- -- Name: fg_pago fk_fg_pago_orden; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_pago
--     ADD CONSTRAINT fk_fg_pago_orden FOREIGN KEY (orden_pago_id) REFERENCES public.fg_orden_pago(id) ON UPDATE CASCADE ON DELETE CASCADE;
--
--
-- --
-- -- Name: fg_pago fk_fg_pago_tarjeta; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_pago
--     ADD CONSTRAINT fk_fg_pago_tarjeta FOREIGN KEY (tarjeta_key) REFERENCES public.tarjeta(key) ON UPDATE CASCADE ON DELETE RESTRICT;
--
--
-- --
-- -- Name: fg_pago fk_fg_pago_tipo_contado; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_pago
--     ADD CONSTRAINT fk_fg_pago_tipo_contado FOREIGN KEY (tipocontado_key) REFERENCES public.tipocontado(key) ON UPDATE CASCADE ON DELETE RESTRICT;
--
--
-- --
-- -- Name: fg_planta fk_fg_planta_empresa; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_planta
--     ADD CONSTRAINT fk_fg_planta_empresa FOREIGN KEY (empresa_key) REFERENCES public.fg_empresa(key) ON UPDATE CASCADE ON DELETE RESTRICT;
--
--
-- --
-- -- Name: fg_perfil_permiso fk_fg_pp_perfil; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_perfil_permiso
--     ADD CONSTRAINT fk_fg_pp_perfil FOREIGN KEY (perfil_clave) REFERENCES public.fg_perfil(clave);
--
--
-- --
-- -- Name: fg_perfil_permiso fk_fg_pp_permiso; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_perfil_permiso
--     ADD CONSTRAINT fk_fg_pp_permiso FOREIGN KEY (permiso_clave) REFERENCES public.fg_permiso(clave);
--
--
-- --
-- -- Name: fg_producto_facturacion fk_fg_producto_facturacion_categoria; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_producto_facturacion
--     ADD CONSTRAINT fk_fg_producto_facturacion_categoria FOREIGN KEY (categoria_id) REFERENCES public.fg_categoria_servicio(id) ON UPDATE CASCADE ON DELETE RESTRICT;
--
--
-- --
-- -- Name: fg_producto_facturacion fk_fg_producto_facturacion_chip; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_producto_facturacion
--     ADD CONSTRAINT fk_fg_producto_facturacion_chip FOREIGN KEY (producto_chip_id) REFERENCES public.fg_producto_inventariable(id) ON DELETE RESTRICT;
--
--
-- --
-- -- Name: fg_producto_inventariable_sede fk_fg_producto_inventariable_sede_producto_facturacion; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_producto_inventariable_sede
--     ADD CONSTRAINT fk_fg_producto_inventariable_sede_producto_facturacion FOREIGN KEY (producto_facturacion_id) REFERENCES public.fg_producto_facturacion(id) ON UPDATE CASCADE ON DELETE RESTRICT;
--
--
-- --
-- -- Name: fg_producto_sede fk_fg_producto_sede_planta; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_producto_sede
--     ADD CONSTRAINT fk_fg_producto_sede_planta FOREIGN KEY (planta_key) REFERENCES public.fg_planta(key) ON UPDATE CASCADE ON DELETE RESTRICT;
--
--
-- --
-- -- Name: fg_producto_sede fk_fg_producto_sede_producto; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_producto_sede
--     ADD CONSTRAINT fk_fg_producto_sede_producto FOREIGN KEY (producto_facturacion_id) REFERENCES public.fg_producto_facturacion(id) ON UPDATE CASCADE ON DELETE RESTRICT;
--
--
-- --
-- -- Name: fg_serie_comprobante fk_fg_serie_comprobante_planta; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_serie_comprobante
--     ADD CONSTRAINT fk_fg_serie_comprobante_planta FOREIGN KEY (planta_key) REFERENCES public.fg_planta(key) ON UPDATE CASCADE ON DELETE RESTRICT;
--
--
-- --
-- -- Name: fg_serie_comprobante fk_fg_serie_empresa; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_serie_comprobante
--     ADD CONSTRAINT fk_fg_serie_empresa FOREIGN KEY (empresa_key) REFERENCES public.fg_empresa(key) ON UPDATE CASCADE ON DELETE RESTRICT;
--
--
-- --
-- -- Name: fg_servicio fk_fg_servicio_categoria; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_servicio
--     ADD CONSTRAINT fk_fg_servicio_categoria FOREIGN KEY (categoria_id) REFERENCES public.fg_categoria_servicio(id) ON UPDATE CASCADE ON DELETE RESTRICT;
--
--
-- --
-- -- Name: fg_taller_autorizado fk_fg_taller_autorizado_planta; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_taller_autorizado
--     ADD CONSTRAINT fk_fg_taller_autorizado_planta FOREIGN KEY (planta_key) REFERENCES public.fg_planta(key) ON UPDATE CASCADE ON DELETE RESTRICT;
--
--
-- --
-- -- Name: fg_tarifa fk_fg_tarifa_planta; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_tarifa
--     ADD CONSTRAINT fk_fg_tarifa_planta FOREIGN KEY (planta_key) REFERENCES public.fg_planta(key);
--
--
-- --
-- -- Name: fg_tarifa fk_fg_tarifa_producto_facturacion; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_tarifa
--     ADD CONSTRAINT fk_fg_tarifa_producto_facturacion FOREIGN KEY (producto_facturacion_id) REFERENCES public.fg_producto_facturacion(id) ON UPDATE CASCADE ON DELETE RESTRICT;
--
--
-- --
-- -- Name: fg_tarifa fk_fg_tarifa_servicio; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_tarifa
--     ADD CONSTRAINT fk_fg_tarifa_servicio FOREIGN KEY (servicio_id) REFERENCES public.fg_servicio(id) ON UPDATE CASCADE ON DELETE RESTRICT;
--
--
-- --
-- -- Name: fg_usuario_planta fk_fg_up_planta; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_usuario_planta
--     ADD CONSTRAINT fk_fg_up_planta FOREIGN KEY (plantas_key) REFERENCES public.fg_planta(key);
--
--
-- --
-- -- Name: fg_usuario_planta fk_fg_up_usuario; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_usuario_planta
--     ADD CONSTRAINT fk_fg_up_usuario FOREIGN KEY (usuario_username) REFERENCES public.fg_usuario(username) ON UPDATE CASCADE;
--
--
-- --
-- -- Name: fg_usuario_sesion fk_fg_us_planta; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_usuario_sesion
--     ADD CONSTRAINT fk_fg_us_planta FOREIGN KEY (planta_key) REFERENCES public.fg_planta(key);
--
--
-- --
-- -- Name: fg_usuario_sesion fk_fg_us_usuario; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_usuario_sesion
--     ADD CONSTRAINT fk_fg_us_usuario FOREIGN KEY (usuario_username) REFERENCES public.fg_usuario(username) ON UPDATE CASCADE;
--
--
-- --
-- -- Name: fg_usuario_perfil fk_fg_usuario_perfil_usuario; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_usuario_perfil
--     ADD CONSTRAINT fk_fg_usuario_perfil_usuario FOREIGN KEY (usuario_username) REFERENCES public.fg_usuario(username) ON UPDATE CASCADE ON DELETE CASCADE;
--
--
-- --
-- -- Name: fg_usuario fk_fg_usuario_perfil; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_usuario
--     ADD CONSTRAINT fk_fg_usuario_perfil FOREIGN KEY (perfil_id) REFERENCES public.fg_perfil(clave);
--
--
-- --
-- -- Name: fg_usuario fk_fg_usuario_persona; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_usuario
--     ADD CONSTRAINT fk_fg_usuario_persona FOREIGN KEY (persona_nrodocumentoidentidad) REFERENCES public.persona(nrodocumentoidentidad) ON UPDATE CASCADE ON DELETE SET NULL;
--
--
-- --
-- -- Name: fg_vehiculo fk_fg_vehiculo_certificado_origen; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_vehiculo
--     ADD CONSTRAINT fk_fg_vehiculo_certificado_origen FOREIGN KEY (certificado_origen_id) REFERENCES public.fg_certificado(id) ON UPDATE CASCADE ON DELETE SET NULL;
--
--
-- --
-- -- Name: fg_vehiculo fk_fg_vehiculo_usuario_creacion; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_vehiculo
--     ADD CONSTRAINT fk_fg_vehiculo_usuario_creacion FOREIGN KEY (usuario_creacion) REFERENCES public.fg_usuario(username) ON UPDATE CASCADE;
--
--
-- --
-- -- Name: fg_vehiculo fk_fg_vehiculo_usuario_modificacion; Type: FK CONSTRAINT; Schema: public; Owner: -
-- --
--
-- ALTER TABLE ONLY public.fg_vehiculo
--     ADD CONSTRAINT fk_fg_vehiculo_usuario_modificacion FOREIGN KEY (usuario_modificacion) REFERENCES public.fg_usuario(username) ON UPDATE CASCADE;
--
--
-- --
-- -- Solicitudes pagadas de duplicados de certificados FAREGAS.
-- -- Conserva una copia inmutable de la representacion emitida; nunca crea ni
-- -- modifica un certificado tecnico ni consume un correlativo de certificado.
-- --
--
-- CREATE TABLE public.fg_certificado_duplicado (
--     id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
--     certificado_original_id bigint NOT NULL,
--     operacion_id bigint NOT NULL,
--     facturacion_id bigint,
--     planta_key character varying(20) NOT NULL,
--     placa character varying(12) NOT NULL,
--     tipo_certificado_clave character varying(30) NOT NULL,
--     modalidad character varying(20) NOT NULL,
--     numero_certificado_snapshot character varying(50) NOT NULL,
--     tipo_nombre_snapshot character varying(150) NOT NULL,
--     fecha_emision_snapshot date NOT NULL,
--     fecha_limite_snapshot date NOT NULL,
--     html_original_snapshot text NOT NULL,
--     motivo character varying(30) DEFAULT 'PERDIDA'::character varying NOT NULL,
--     observacion text,
--     precio numeric(10,2) DEFAULT 50.00 NOT NULL,
--     estado character varying(30) DEFAULT 'PENDIENTE_PAGO'::character varying NOT NULL,
--     solicitado_por character varying(255) NOT NULL,
--     fecha_solicitud timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
--     fecha_disponible timestamp without time zone,
--     cantidad_descargas integer DEFAULT 0 NOT NULL,
--     ultima_descarga timestamp without time zone,
--     fecha_modificacion timestamp without time zone,
--     CONSTRAINT ck_fg_certificado_duplicado_estado CHECK (((estado)::text = ANY ((ARRAY['PENDIENTE_PAGO'::character varying, 'PENDIENTE_COMPROBANTE'::character varying, 'DISPONIBLE'::character varying, 'ANULADO'::character varying])::text[]))),
--     CONSTRAINT ck_fg_certificado_duplicado_modalidad CHECK (((modalidad)::text = ANY ((ARRAY['INICIAL'::character varying, 'ANUAL'::character varying])::text[]))),
--     CONSTRAINT ck_fg_certificado_duplicado_motivo CHECK (((motivo)::text = 'PERDIDA'::text)),
--     CONSTRAINT ck_fg_certificado_duplicado_precio CHECK ((precio = 50.00)),
--     CONSTRAINT ck_fg_certificado_duplicado_descargas CHECK ((cantidad_descargas >= 0)),
--     CONSTRAINT uq_fg_certificado_duplicado_operacion UNIQUE (operacion_id),
--     CONSTRAINT uq_fg_certificado_duplicado_facturacion UNIQUE (facturacion_id),
--     CONSTRAINT fk_fg_certificado_duplicado_certificado FOREIGN KEY (certificado_original_id) REFERENCES public.fg_certificado(id) ON UPDATE CASCADE ON DELETE RESTRICT,
--     CONSTRAINT fk_fg_certificado_duplicado_operacion FOREIGN KEY (operacion_id) REFERENCES public.fg_operacion_comercial(id) ON UPDATE CASCADE ON DELETE RESTRICT,
--     CONSTRAINT fk_fg_certificado_duplicado_facturacion FOREIGN KEY (facturacion_id) REFERENCES public.fg_facturacion(id) ON UPDATE CASCADE ON DELETE SET NULL,
--     CONSTRAINT fk_fg_certificado_duplicado_planta FOREIGN KEY (planta_key) REFERENCES public.fg_planta(key) ON UPDATE CASCADE ON DELETE RESTRICT
-- );
--
-- CREATE INDEX idx_fg_certificado_duplicado_busqueda
--     ON public.fg_certificado_duplicado (planta_key, placa, tipo_certificado_clave, modalidad, fecha_emision_snapshot DESC);
--
-- CREATE INDEX idx_fg_certificado_duplicado_original
--     ON public.fg_certificado_duplicado (certificado_original_id);
--
-- CREATE INDEX idx_fg_certificado_duplicado_estado
--     ON public.fg_certificado_duplicado (estado, fecha_solicitud DESC);
--
-- CREATE UNIQUE INDEX uq_fg_certificado_duplicado_pendiente_usuario
--     ON public.fg_certificado_duplicado (certificado_original_id, solicitado_por)
--     WHERE ((estado)::text = 'PENDIENTE_PAGO'::text);
--
--
-- --
-- -- Catálogo y asignaciones iniciales de operaciones fiscales sensibles.
-- -- El esquema maestro representa una instalación nueva; las bases existentes
-- -- deben usar 20261022_faregas_fase0_seguridad_documentos.sql.
-- --
--
-- INSERT INTO public.fg_permiso (clave, nombre, modulo, descripcion, activo)
-- VALUES
--     ('FAREGAS_ANULAR_COMPROBANTE', 'Anular comprobante electrónico FAREGAS', 'FAREGAS', 'Permite iniciar la baja fiscal de comprobantes electrónicos FAREGAS; no anula certificados técnicos ni devuelve pagos.', TRUE),
--     ('FAREGAS_NOTA_CREDITO', 'Emitir nota de crédito FAREGAS', 'FAREGAS', 'Permite emitir notas de crédito vinculadas a comprobantes FAREGAS.', TRUE)
-- ON CONFLICT (clave) DO UPDATE
-- SET nombre = EXCLUDED.nombre,
--     modulo = EXCLUDED.modulo,
--     descripcion = EXCLUDED.descripcion,
--     activo = EXCLUDED.activo;
--
-- INSERT INTO public.fg_perfil_permiso (perfil_clave, permiso_clave)
-- SELECT perfil.clave, permiso.clave
-- FROM public.fg_perfil perfil
-- CROSS JOIN (
--     VALUES
--         ('FAREGAS_ANULAR_COMPROBANTE'::varchar),
--         ('FAREGAS_NOTA_CREDITO'::varchar)
-- ) permiso(clave)
-- WHERE perfil.clave = 'SISTEMAS'
-- ON CONFLICT (perfil_clave, permiso_clave) DO NOTHING;
--
--
-- --
-- -- PostgreSQL database dump complete
-- --
--
-- --
-- -- FAREGAS FASE 1: solicitudes administrativas de anulación y rectificación.
-- -- La aprobación es únicamente administrativa y no ejecuta efectos técnicos o
-- -- fiscales. Para bases existentes use la migración incremental 20261022.
-- --
--
-- CREATE TABLE public.fg_solicitud_operacion (
--     id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
--     tipo_operacion varchar(40) NOT NULL,
--     certificado_id bigint,
--     facturacion_id bigint,
--     empresa_key varchar NOT NULL,
--     planta_key varchar(20) NOT NULL,
--     usuario_solicitante varchar(255) NOT NULL,
--     motivo varchar(500) NOT NULL,
--     observaciones text,
--     estado varchar(40) NOT NULL DEFAULT 'PENDIENTE_APROBACION',
--     usuario_decision varchar(255),
--     fecha_solicitud timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
--     fecha_decision timestamptz,
--     justificacion_decision varchar(1000),
--     datos_originales_certificado jsonb,
--     datos_originales_comprobante jsonb,
--     datos_propuestos jsonb,
--     fecha_emision_original date,
--     resultado_tecnico jsonb,
--     resultado_fiscal jsonb,
--     idempotencia_clave uuid NOT NULL,
--     usuario_ejecucion varchar(255),
--     fecha_ejecucion timestamptz,
--     idempotencia_ejecucion uuid,
--     autorizacion_autoejecucion boolean NOT NULL DEFAULT FALSE,
--     version integer NOT NULL DEFAULT 1,
--     fecha_creacion timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
--     fecha_modificacion timestamptz,
--     CONSTRAINT fk_fg_solicitud_certificado FOREIGN KEY (certificado_id) REFERENCES public.fg_certificado(id) ON DELETE RESTRICT,
--     CONSTRAINT fk_fg_solicitud_facturacion FOREIGN KEY (facturacion_id) REFERENCES public.fg_facturacion(id) ON DELETE RESTRICT,
--     CONSTRAINT fk_fg_solicitud_empresa FOREIGN KEY (empresa_key) REFERENCES public.fg_empresa(key) ON DELETE RESTRICT,
--     CONSTRAINT fk_fg_solicitud_planta FOREIGN KEY (planta_key) REFERENCES public.fg_planta(key) ON DELETE RESTRICT,
--     CONSTRAINT fk_fg_solicitud_solicitante FOREIGN KEY (usuario_solicitante) REFERENCES public.fg_usuario(username) ON DELETE RESTRICT,
--     CONSTRAINT fk_fg_solicitud_decisor FOREIGN KEY (usuario_decision) REFERENCES public.fg_usuario(username) ON DELETE RESTRICT,
--     CONSTRAINT fk_fg_solicitud_ejecutor FOREIGN KEY (usuario_ejecucion) REFERENCES public.fg_usuario(username) ON DELETE RESTRICT,
--     CONSTRAINT ck_fg_solicitud_tipo CHECK (tipo_operacion IN ('ANULAR_CERTIFICADO', 'ANULAR_COMPROBANTE', 'ANULAR_AMBOS', 'EMITIR_NOTA_CREDITO', 'RECTIFICAR_CERTIFICADO', 'RECTIFICAR_COMPROBANTE', 'RECTIFICAR_AMBOS')),
--     CONSTRAINT ck_fg_solicitud_estado CHECK (estado IN ('PENDIENTE_APROBACION', 'APROBADA', 'RECHAZADA', 'CANCELADA', 'EN_EJECUCION', 'COMPLETADA', 'ERROR', 'REQUIERE_INTERVENCION')),
--     CONSTRAINT ck_fg_solicitud_documentos CHECK (
--         (tipo_operacion IN ('ANULAR_CERTIFICADO', 'RECTIFICAR_CERTIFICADO') AND certificado_id IS NOT NULL)
--         OR (tipo_operacion IN ('ANULAR_COMPROBANTE', 'RECTIFICAR_COMPROBANTE') AND facturacion_id IS NOT NULL)
--         OR (tipo_operacion = 'ANULAR_AMBOS' AND certificado_id IS NOT NULL)
--         OR (tipo_operacion = 'EMITIR_NOTA_CREDITO' AND certificado_id IS NOT NULL AND facturacion_id IS NOT NULL)
--         OR (tipo_operacion = 'RECTIFICAR_AMBOS' AND certificado_id IS NOT NULL AND facturacion_id IS NOT NULL)
--     ),
--     CONSTRAINT ck_fg_solicitud_motivo CHECK (btrim(motivo) <> ''),
--     CONSTRAINT ck_fg_solicitud_version CHECK (version > 0),
--     CONSTRAINT ck_fg_solicitud_no_autoejecucion CHECK (
--         usuario_ejecucion IS NULL
--         OR usuario_ejecucion IS DISTINCT FROM usuario_solicitante
--         OR (usuario_ejecucion = usuario_solicitante AND autorizacion_autoejecucion = TRUE)
--     ),
--     CONSTRAINT uq_fg_solicitud_idempotencia UNIQUE (usuario_solicitante, idempotencia_clave)
-- );
--
-- CREATE TABLE public.fg_solicitud_operacion_evento (
--     id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
--     solicitud_id bigint NOT NULL REFERENCES public.fg_solicitud_operacion(id) ON DELETE RESTRICT,
--     tipo_evento varchar(50) NOT NULL,
--     estado_anterior varchar(40),
--     estado_posterior varchar(40) NOT NULL,
--     usuario_responsable varchar(255) NOT NULL REFERENCES public.fg_usuario(username) ON DELETE RESTRICT,
--     fecha_evento timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
--     comentario text,
--     metadatos jsonb,
--     CONSTRAINT ck_fg_solicitud_evento_anterior CHECK (estado_anterior IS NULL OR estado_anterior IN ('PENDIENTE_APROBACION', 'APROBADA', 'RECHAZADA', 'CANCELADA', 'EN_EJECUCION', 'COMPLETADA', 'ERROR', 'REQUIERE_INTERVENCION')),
--     CONSTRAINT ck_fg_solicitud_evento_posterior CHECK (estado_posterior IN ('PENDIENTE_APROBACION', 'APROBADA', 'RECHAZADA', 'CANCELADA', 'EN_EJECUCION', 'COMPLETADA', 'ERROR', 'REQUIERE_INTERVENCION'))
-- );
--
-- CREATE TABLE public.fg_nota_credito_trabajo (
--     id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
--     solicitud_id bigint NOT NULL REFERENCES public.fg_solicitud_operacion(id) ON DELETE RESTRICT,
--     certificado_id bigint NOT NULL REFERENCES public.fg_certificado(id) ON DELETE RESTRICT,
--     facturacion_id bigint NOT NULL REFERENCES public.fg_facturacion(id) ON DELETE RESTRICT,
--     credito_id bigint REFERENCES public.fg_credito(id) ON DELETE RESTRICT,
--     empresa_key varchar(40) NOT NULL REFERENCES public.fg_empresa(key) ON DELETE RESTRICT,
--     planta_key varchar(40) NOT NULL REFERENCES public.fg_planta(key) ON DELETE RESTRICT,
--     motivo_codigo varchar(2) NOT NULL,
--     sustento_aprobado text NOT NULL,
--     datos_aprobados jsonb NOT NULL DEFAULT '{}'::jsonb,
--     estado varchar(30) NOT NULL DEFAULT 'EN_COLA',
--     intentos integer NOT NULL DEFAULT 0,
--     disponible_desde timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
--     propietario_bloqueo uuid,
--     bloqueo_hasta timestamptz,
--     usuario_ejecutor varchar(255) NOT NULL REFERENCES public.fg_usuario(username) ON DELETE RESTRICT,
--     ultimo_error_codigo varchar(100),
--     ultimo_error_mensaje text,
--     resultado jsonb,
--     fecha_creacion timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
--     fecha_modificacion timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
--     fecha_inicio timestamptz,
--     fecha_finalizacion timestamptz,
--     CONSTRAINT uq_fg_nota_credito_trabajo_solicitud UNIQUE (solicitud_id),
--     CONSTRAINT ck_fg_nota_credito_trabajo_motivo CHECK (motivo_codigo IN ('01', '02', '03')),
--     CONSTRAINT ck_fg_nota_credito_trabajo_estado CHECK (estado IN ('EN_COLA', 'ESPERANDO_COMPROBANTE', 'EMITIENDO', 'PENDIENTE_SUNAT', 'ACEPTADA', 'RECHAZADA', 'BLOQUEADA', 'RESULTADO_INCIERTO', 'ERROR')),
--     CONSTRAINT ck_fg_nota_credito_trabajo_intentos CHECK (intentos >= 0)
-- );
--
-- CREATE INDEX idx_fg_solicitud_planta ON public.fg_solicitud_operacion (planta_key, fecha_solicitud DESC);
-- CREATE INDEX idx_fg_solicitud_empresa ON public.fg_solicitud_operacion (empresa_key, fecha_solicitud DESC);
-- CREATE INDEX idx_fg_solicitud_estado ON public.fg_solicitud_operacion (estado, fecha_solicitud DESC);
-- CREATE INDEX idx_fg_solicitud_tipo ON public.fg_solicitud_operacion (tipo_operacion, fecha_solicitud DESC);
-- CREATE INDEX idx_fg_solicitud_cert_tipo_estado ON public.fg_solicitud_operacion (certificado_id, tipo_operacion, estado, fecha_solicitud DESC);
-- CREATE INDEX idx_fg_solicitud_solicitante ON public.fg_solicitud_operacion (usuario_solicitante, fecha_solicitud DESC);
-- CREATE INDEX idx_fg_solicitud_ejecutor ON public.fg_solicitud_operacion (usuario_ejecucion, fecha_ejecucion DESC)
--     WHERE usuario_ejecucion IS NOT NULL;
-- CREATE INDEX idx_fg_solicitud_evento_historial ON public.fg_solicitud_operacion_evento (solicitud_id, fecha_evento, id);
-- CREATE INDEX idx_fg_nota_credito_trabajo_pendiente ON public.fg_nota_credito_trabajo (estado, disponible_desde, id)
--     WHERE estado IN ('EN_COLA', 'ESPERANDO_COMPROBANTE', 'PENDIENTE_SUNAT', 'RESULTADO_INCIERTO', 'ERROR');
-- CREATE INDEX idx_fg_nota_credito_trabajo_bloqueo ON public.fg_nota_credito_trabajo (bloqueo_hasta)
--     WHERE estado = 'EMITIENDO';
-- CREATE UNIQUE INDEX uq_fg_solicitud_activa_certificado ON public.fg_solicitud_operacion (certificado_id)
--     WHERE certificado_id IS NOT NULL AND estado IN ('PENDIENTE_APROBACION', 'APROBADA', 'EN_EJECUCION', 'REQUIERE_INTERVENCION');
-- CREATE UNIQUE INDEX uq_fg_solicitud_activa_facturacion ON public.fg_solicitud_operacion (facturacion_id)
--     WHERE facturacion_id IS NOT NULL AND estado IN ('PENDIENTE_APROBACION', 'APROBADA', 'EN_EJECUCION', 'REQUIERE_INTERVENCION');
--
-- CREATE FUNCTION public.fg_bloquear_mutacion_solicitud_evento()
-- RETURNS trigger LANGUAGE plpgsql AS $$
-- BEGIN
--     RAISE EXCEPTION 'El historial de solicitudes administrativas es inmutable.' USING ERRCODE = '55000';
-- END;
-- $$;
--
-- CREATE TRIGGER trg_fg_solicitud_evento_inmutable
-- BEFORE UPDATE OR DELETE ON public.fg_solicitud_operacion_evento
-- FOR EACH ROW EXECUTE FUNCTION public.fg_bloquear_mutacion_solicitud_evento();
--
-- INSERT INTO public.fg_permiso (clave, nombre, modulo, descripcion, activo)
-- VALUES
--     ('FAREGAS_SOLICITUD_CREAR', 'Solicitar anulación total', 'FAREGAS', 'Permite a un perfil autorizado por RBAC solicitar la anulación total sin aprobarla ni ejecutarla.', TRUE),
--     ('FAREGAS_SOLICITUD_VER', 'Consultar solicitudes de anulación', 'FAREGAS', 'Permite consultar solicitudes dentro del alcance autorizado.', TRUE),
--     ('FAREGAS_SOLICITUD_APROBAR', 'Aprobar anulaciones', 'FAREGAS', 'Permite aprobar solicitudes de anulación dentro del alcance autorizado.', TRUE),
--     ('FAREGAS_SOLICITUD_AUTOAPROBAR', 'Autoaprobar anulación excepcional', 'FAREGAS', 'Permite aprobar excepcionalmente una solicitud propia con justificación y confirmación explícitas. No habilita la ejecución fiscal.', TRUE),
--     ('FAREGAS_SOLICITUD_AUTOEJECUTAR', 'Autoejecución excepcional de anulación', 'FAREGAS', 'Permite ejecutar una solicitud propia previamente aprobada, con confirmación explícita, justificación obligatoria y auditoría inmutable.', TRUE),
--     ('FAREGAS_SOLICITUD_RECHAZAR', 'Rechazar anulaciones', 'FAREGAS', 'Permite rechazar solicitudes de otro usuario dentro del alcance autorizado.', TRUE),
--     ('FAREGAS_SOLICITUD_ADMINISTRAR', 'Administrar solicitudes de anulación', 'FAREGAS', 'Permite administrar solicitudes sin omitir la separación de funciones.', TRUE),
--     ('FAREGAS_ACCESO_GLOBAL_SEDES', 'Acceso global a sedes', 'FAREGAS', 'Permite operar en todas las sedes activas, sin conceder permisos operativos adicionales.', TRUE),
--     ('FAREGAS_CERTIFICADO_ANULAR_EJECUTAR', 'Ejecutar anulación autorizada', 'FAREGAS', 'Permite iniciar la ejecución de una anulación total aprobada y ajena dentro del alcance autorizado.', TRUE),
--     ('FAREGAS_CERTIFICADO_RECTIFICAR_EJECUTAR', 'Rectificar directamente un certificado', 'FAREGAS', 'Permite rectificar directamente un certificado emitido, con versionado y auditoría, sin alterar comprobantes, pagos, fecha original ni correlativo DG.', TRUE),
--     ('FAREGAS_NOTA_CREDITO_APROBAR', 'Aprobar o rechazar solicitudes de nota de crédito FAREGAS', 'FAREGAS', 'Permite aprobar o rechazar solicitudes administrativas de autorización de notas de crédito dentro de las sedes autorizadas.', TRUE),
--     ('FAREGAS_NOTA_CREDITO_AUTOAPROBAR', 'Autoaprobar solicitud propia de nota de crédito FAREGAS', 'FAREGAS', 'Permite autoaprobar una solicitud propia de nota de crédito únicamente si también se tiene el permiso FAREGAS_NOTA_CREDITO_APROBAR.', TRUE)
-- ON CONFLICT (clave) DO UPDATE SET nombre = EXCLUDED.nombre, modulo = EXCLUDED.modulo, descripcion = EXCLUDED.descripcion, activo = EXCLUDED.activo;
--
-- INSERT INTO public.fg_perfil_permiso (perfil_clave, permiso_clave)
-- SELECT perfil.clave, permiso.clave
-- FROM public.fg_perfil perfil
-- JOIN (VALUES
--     ('OPERADOR'::varchar, 'FAREGAS_SOLICITUD_CREAR'::varchar),
--     ('OPERADOR'::varchar, 'FAREGAS_SOLICITUD_VER'::varchar),
--     ('JEFE_PLANTA'::varchar, 'FAREGAS_SOLICITUD_VER'::varchar),
--     ('SISTEMAS'::varchar, 'FAREGAS_SOLICITUD_CREAR'::varchar),
--     ('SISTEMAS'::varchar, 'FAREGAS_SOLICITUD_VER'::varchar),
--     ('SISTEMAS'::varchar, 'FAREGAS_SOLICITUD_APROBAR'::varchar),
--     ('SISTEMAS'::varchar, 'FAREGAS_SOLICITUD_AUTOAPROBAR'::varchar),
--     ('SISTEMAS'::varchar, 'FAREGAS_SOLICITUD_RECHAZAR'::varchar),
--     ('SISTEMAS'::varchar, 'FAREGAS_SOLICITUD_ADMINISTRAR'::varchar),
--     ('SISTEMAS'::varchar, 'FAREGAS_ACCESO_GLOBAL_SEDES'::varchar),
--     ('SISTEMAS'::varchar, 'FAREGAS_CERTIFICADO_ANULAR_EJECUTAR'::varchar),
--     ('SISTEMAS'::varchar, 'FAREGAS_CERTIFICADO_RECTIFICAR_EJECUTAR'::varchar),
--     ('SISTEMAS'::varchar, 'FAREGAS_NOTA_CREDITO_APROBAR'::varchar),
--     ('SISTEMAS'::varchar, 'FAREGAS_NOTA_CREDITO_AUTOAPROBAR'::varchar)
-- ) permiso(perfil_clave, clave) ON permiso.perfil_clave = perfil.clave
-- ON CONFLICT (perfil_clave, permiso_clave) DO NOTHING;
--
-- -- ============================================================================
-- -- FASE 3: VERSIONADO DE CERTIFICADOS
-- -- ============================================================================
-- CREATE TABLE public.fg_certificado_version (
--     id bigserial PRIMARY KEY,
--     certificado_id bigint NOT NULL REFERENCES public.fg_certificado(id) ON DELETE RESTRICT,
--     solicitud_id bigint REFERENCES public.fg_solicitud_operacion(id) ON DELETE SET NULL,
--     numero_version integer NOT NULL,
--     estado_version varchar(30) NOT NULL,
--     es_vigente boolean NOT NULL DEFAULT FALSE,
--     fecha_emision_original date NOT NULL,
--     fecha_version timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
--     fecha_aplicacion_oficial timestamptz,
--     usuario_creacion varchar(255) NOT NULL REFERENCES public.fg_usuario(username) ON DELETE RESTRICT,
--     usuario_aprobacion varchar(255) REFERENCES public.fg_usuario(username) ON DELETE RESTRICT,
--     motivo text NOT NULL,
--     snapshot_datos jsonb NOT NULL,
--     diferencias jsonb,
--     enlace_pdf_original text,
--     enlace_pdf_version text,
--     metadatos jsonb,
--     CONSTRAINT ck_fg_certificado_version_estado CHECK (
--         estado_version IN ('ORIGINAL', 'PROPUESTA', 'PREPARADA', 'VIGENTE', 'SUSTITUIDA', 'RECHAZADA')
--     ),
--     CONSTRAINT uq_fg_certificado_version_num UNIQUE (certificado_id, numero_version)
-- );
--
-- CREATE INDEX idx_fg_cert_ver_certificado ON public.fg_certificado_version (certificado_id, numero_version DESC);
-- CREATE INDEX idx_fg_cert_ver_solicitud ON public.fg_certificado_version (solicitud_id);
-- CREATE INDEX idx_fg_cert_ver_estado ON public.fg_certificado_version (estado_version, fecha_version DESC);
-- CREATE UNIQUE INDEX uq_fg_cert_ver_unica_vigente ON public.fg_certificado_version (certificado_id)
--     WHERE es_vigente = TRUE;
--
-- -- ============================================================================
-- -- NOTIFICACIONES PERSISTENTES POR USUARIO
-- -- ============================================================================
--
-- CREATE TABLE public.fg_notificacion (
--     id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
--     evento_clave varchar(80) NOT NULL UNIQUE,
--     tipo varchar(40) NOT NULL,
--     titulo varchar(160) NOT NULL,
--     mensaje varchar(500) NOT NULL,
--     planta_key varchar(80),
--     empresa_key varchar(80),
--     entidad_tipo varchar(60),
--     entidad_id bigint,
--     destino_navegacion varchar(200),
--     fecha_creacion timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
--     creado_por varchar(80)
-- );
--
-- CREATE TABLE public.fg_notificacion_destinatario (
--     id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
--     notificacion_id bigint NOT NULL REFERENCES public.fg_notificacion(id) ON DELETE CASCADE,
--     usuario_id varchar(80) NOT NULL,
--     leida boolean NOT NULL DEFAULT FALSE,
--     fecha_lectura timestamptz,
--     CONSTRAINT fg_notificacion_destinatario_notificacion_id_usuario_id_key
--         UNIQUE (notificacion_id, usuario_id)
-- );
--
-- CREATE INDEX idx_fg_notificacion_destinatario_usuario
--     ON public.fg_notificacion_destinatario (usuario_id);
-- CREATE INDEX idx_fg_notificacion_destinatario_leida
--     ON public.fg_notificacion_destinatario (leida);
-- CREATE INDEX idx_fg_notificacion_evento_clave
--     ON public.fg_notificacion (evento_clave);
-- CREATE INDEX idx_fg_notificacion_fecha
--     ON public.fg_notificacion (fecha_creacion DESC);
--
-- INSERT INTO public.fg_descuento (
--     codigo, nombre, tipo, tipo_calculo, valor,
--     fecha_inicio, fecha_fin, activo, usuario_creacion
-- )
-- SELECT
--     'CORTESIA_FAREGAS', 'CORTESÍA FAREGAS', 'PROMOCION', 'PORCENTAJE', 100,
--     TIMESTAMP '2020-01-01 00:00:00', TIMESTAMP '2099-12-31 23:59:59', TRUE,
--     'INSTALACION_FAREGAS'
-- WHERE NOT EXISTS (
--     SELECT 1
--     FROM public.fg_descuento
--     WHERE UPPER(BTRIM(codigo)) = 'CORTESIA_FAREGAS'
-- );
--
-- -- BEGIN CATALOGO_RBAC_FAREGAS_GENERADO
-- -- Catálogo RBAC observado mediante SELECT; no contiene usuarios ni secretos.
-- -- Fuente: 192.168.14.19/32:5432/inspeccion.
--
-- INSERT INTO public.fg_perfil (clave, nombre, visible)
-- VALUES
--     ('AMINISTRADOR', 'ADMINISTRADOR', TRUE),
--     ('CONTADOR', 'CONTADOR', TRUE),
--     ('JEFE_PLANTA', 'Jefe de Planta', TRUE),
--     ('OPERADOR', 'operador/emisor/ventas', TRUE),
--     ('SISTEMAS', 'Sistemas', TRUE),
--     ('SUPERVISOR', 'SUPERVISOR', TRUE)
-- ON CONFLICT (clave) DO UPDATE
-- SET nombre = EXCLUDED.nombre, visible = EXCLUDED.visible;
--
-- INSERT INTO public.fg_permiso (clave, nombre, modulo, descripcion, activo)
-- VALUES
--     ('CHIPS_BAJA', 'Dar de baja chips', 'FAREGAS', 'Dar de baja chips disponibles', TRUE),
--     ('CHIPS_CONFIGURAR', 'Configurar productos inventariables', 'FAREGAS', 'Crear y editar productos inventariables y su disponibilidad por sede', TRUE),
--     ('CHIPS_INGRESAR', 'Ingresar chips', 'FAREGAS', 'Registrar chips físicos en una sede', TRUE),
--     ('CHIPS_TRANSFERIR', 'Transferir chips', 'FAREGAS', 'Mover chips disponibles entre sedes', TRUE),
--     ('CHIPS_VENDER', 'Vender chips', 'FAREGAS', 'Reservar y liberar chips, validar y registrar ventas de chips con su comprobante', TRUE),
--     ('CHIPS_VER', 'Ver inventario de chips', 'FAREGAS', 'Consultar stock e historial de chips', TRUE),
--     ('CONFIGURACION_CATEGORIAS', 'Administrar Categorías', 'FAREGAS', 'Administrar categorías comerciales de servicios Faregas', TRUE),
--     ('CONFIGURACION_EMPRESAS', 'Administrar Empresas FAREGAS', 'FAREGAS', 'Editar empresas y asignar sus sedes en FAREGAS', TRUE),
--     ('CONFIGURACION_PRODUCTOS', 'Administrar Productos / SKU', 'FAREGAS', 'Administrar catálogo de productos de facturación Faregas', TRUE),
--     ('CONFIGURACION_SEDES', 'Administrar Sedes', 'FAREGAS', 'Modificar sedes', TRUE),
--     ('CONFIGURACION_SERIES', 'Administrar Series de Comprobante', 'FAREGAS', 'Administrar series propias de comprobantes Faregas por sede', TRUE),
--     ('CONFIGURACION_SERVICIOS', 'Administrar Servicios', 'FAREGAS', 'Modificar catálogo de servicios', TRUE),
--     ('CONFIGURACION_TARIFAS', 'Administrar Tarifas', 'FAREGAS', 'Modificar precios por sede', TRUE),
--     ('DASHBOARD_EXPORTAR', 'Exportar Métricas del Dashboard', 'FAREGAS', 'Permite descargar el libro Excel multi-pestaña con datos del dashboard', TRUE),
--     ('DASHBOARD_GLOBAL', 'Dashboard Global Multi-Sede', 'FAREGAS', 'Permite consolidar métricas de todas las sedes autorizadas del usuario', TRUE),
--     ('DASHBOARD_SEDE', 'Dashboard de Sede Operativa', 'FAREGAS', 'Permite visualizar métricas exclusivas de la sede activa en sesión', TRUE),
--     ('DESCUENTOS_ADMINISTRAR', 'Administrar Descuentos', 'FAREGAS', 'Permite crear y modificar campañas de descuentos FAREGAS', TRUE),
--     ('FAREGAS_ANULAR_COMPROBANTE', 'Anular comprobante electrónico', 'FAREGAS', 'Permite iniciar la baja fiscal de comprobantes electrónicos FAREGAS; no anula certificados técnicos ni devuelve pagos.', TRUE),
--     ('FAREGAS_CERTIFICADO_ANULAR_EJECUTAR', 'Ejecutar anulación autorizada', 'FAREGAS', 'Permite a SISTEMAS iniciar la ejecución de una anulación total aprobada y ajena.', TRUE),
--     ('FAREGAS_CERTIFICADO_RECTIFICAR_EJECUTAR', 'Ejecutar rectificación técnica de certificado', 'FAREGAS', 'Permite ejecutar la rectificación técnica y el versionado de un certificado emitido con solicitud administrativa aprobada, sin emitir comprobantes ni consumir correlativos.', TRUE),
--     ('FAREGAS_NOTA_CREDITO', 'Emitir nota de crédito', 'FAREGAS', 'Permite emitir notas de crédito vinculadas a comprobantes FAREGAS.', TRUE),
--     ('FAREGAS_NOTA_CREDITO_APROBAR', 'Aprobar o rechazar solicitudes de nota de crédito FAREGAS', 'FAREGAS', 'Permite aprobar o rechazar solicitudes administrativas de autorización de notas de crédito dentro de las sedes autorizadas.', TRUE),
--     ('FAREGAS_NOTA_CREDITO_AUTOAPROBAR', 'Autoaprobar solicitud propia de nota de crédito FAREGAS', 'FAREGAS', 'Permite autoaprobar una solicitud propia de nota de crédito únicamente si también se tiene el permiso FAREGAS_NOTA_CREDITO_APROBAR.', TRUE),
--     ('FAREGAS_NOTIFICACION_CORTESIA_RECIBIR', 'Recibir notificaciones de cortesías', 'FAREGAS', 'Recibe avisos informativos cuando se emite una cortesía en una sede autorizada. No autoriza a emitir cortesías.', TRUE),
--     ('FAREGAS_SOLICITUD_ADMINISTRAR', 'Administrar solicitudes de anulación', 'FAREGAS', 'Permite administrar solicitudes sin ejecutar efectos técnicos o fiscales.', TRUE),
--     ('FAREGAS_SOLICITUD_APROBAR', 'Aprobar anulaciones', 'FAREGAS', 'Permite a SISTEMAS aprobar solicitudes de otro usuario dentro del alcance autorizado.', TRUE),
--     ('FAREGAS_SOLICITUD_AUTOAPROBAR', 'Autoaprobar anulación excepcional', 'FAREGAS', 'Permite a SISTEMAS aprobar excepcionalmente una solicitud propia con justificación y confirmación explícitas. No habilita la ejecución fiscal.', TRUE),
--     ('FAREGAS_SOLICITUD_AUTOEJECUTAR', 'Autoejecución excepcional de anulación', 'FAREGAS', 'Permite a un usuario SISTEMAS ejecutar su propia solicitud de anulación previamente aprobada, con confirmación explícita, justificación obligatoria y auditoría inmutable. No se asigna automáticamente a ningún perfil.', TRUE),
--     ('FAREGAS_SOLICITUD_CREAR', 'Solicitar anulación total', 'FAREGAS', 'Permite a un perfil autorizado por RBAC solicitar la anulación total sin aprobarla ni ejecutarla.', TRUE),
--     ('FAREGAS_SOLICITUD_RECHAZAR', 'Rechazar anulaciones', 'FAREGAS', 'Permite a SISTEMAS rechazar solicitudes de otro usuario dentro del alcance autorizado.', TRUE),
--     ('FAREGAS_SOLICITUD_VER', 'Consultar solicitudes de anulación', 'FAREGAS', 'Permite consultar solicitudes dentro del alcance autorizado.', TRUE),
--     ('MENU_AUDITORIA', 'Auditoría', 'MENU', NULL, TRUE),
--     ('MENU_CHIPS', 'Chips', 'MENU', 'Acceso al módulo de inventario de chips FAREGAS', TRUE),
--     ('MENU_CHIPS_INVENTARIO', 'Inventario de chips', 'MENU', 'Acceso a la pestaña Inventario de chips (control de seriales y stock)', TRUE),
--     ('MENU_CHIPS_TIPOS', 'Tipos de chip', 'MENU', 'Acceso a la pestaña Tipos de chip (catálogo de productos inventariables)', TRUE),
--     ('MENU_CHIPS_VENTAS', 'Ventas de chips', 'MENU', 'Acceso a la pestaña Ventas de chips (operaciones y venta directa)', TRUE),
--     ('MENU_CONFIGURACION', 'Configuración', 'MENU', 'Ver módulo configuración', TRUE),
--     ('MENU_CONFIGURACION_CATALOGO', 'Catálogo', 'MENU', 'Acceso a la pestaña Catálogo del módulo Configuración', TRUE),
--     ('MENU_CONFIGURACION_CORRELATIVOS', 'Correlativos', 'MENU', 'Acceso a la pestaña Correlativos de certificados del módulo Configuración', TRUE),
--     ('MENU_CONFIGURACION_EMPRESAS', 'Empresas', 'MENU', 'Acceso a la pestaña Empresas del módulo Configuración', TRUE),
--     ('MENU_CONFIGURACION_SEDES', 'Sedes / Categorías DMS', 'MENU', 'Acceso a la pestaña Sedes / Categorías DMS del módulo Configuración', TRUE),
--     ('MENU_CONFIGURACION_TARIFAS', 'Tarifas por sede', 'MENU', 'Acceso a la pestaña Tarifas por sede del módulo Configuración', TRUE),
--     ('MENU_DASHBOARD', 'Dashboard FAREGAS', 'MENU', 'Acceso al módulo Dashboard en la barra lateral', TRUE),
--     ('MENU_DESCUENTOS', 'Descuentos', 'MENU', NULL, TRUE),
--     ('MENU_FACTURACION', 'Facturación', 'MENU', 'Acceso al módulo de facturación electrónica FAREGAS', TRUE),
--     ('MENU_FACTURACION_CLIENTES', 'Clientes', 'MENU', 'Acceso a la pestaña Clientes y al directorio de clientes de facturación', TRUE),
--     ('MENU_FACTURACION_COMPROBANTES', 'Comprobantes', 'MENU', 'Acceso a la pestaña Comprobantes (seguimiento de comprobantes emitidos)', TRUE),
--     ('MENU_FACTURACION_PREPARACION', 'Preparación', 'MENU', 'Acceso a la pestaña Preparación de facturación (estado de NubeFact por sede)', TRUE),
--     ('MENU_FACTURACION_SERIES', 'Series', 'MENU', 'Acceso a la pestaña Series de facturación (series Nubefact y DMS por sede)', TRUE),
--     ('MENU_INICIO', 'Inicio', 'MENU', NULL, TRUE),
--     ('MENU_USUARIOS', 'Usuarios', 'MENU', NULL, TRUE)
-- ON CONFLICT (clave) DO UPDATE
-- SET nombre = EXCLUDED.nombre, modulo = EXCLUDED.modulo,
--     descripcion = EXCLUDED.descripcion, activo = EXCLUDED.activo;
--
-- INSERT INTO public.fg_perfil_permiso (perfil_clave, permiso_clave)
-- VALUES
--     ('AMINISTRADOR', 'CHIPS_VENDER'),
--     ('AMINISTRADOR', 'CHIPS_VER'),
--     ('AMINISTRADOR', 'CONFIGURACION_CATEGORIAS'),
--     ('AMINISTRADOR', 'CONFIGURACION_EMPRESAS'),
--     ('AMINISTRADOR', 'CONFIGURACION_PRODUCTOS'),
--     ('AMINISTRADOR', 'CONFIGURACION_SEDES'),
--     ('AMINISTRADOR', 'CONFIGURACION_SERIES'),
--     ('AMINISTRADOR', 'CONFIGURACION_SERVICIOS'),
--     ('AMINISTRADOR', 'CONFIGURACION_TARIFAS'),
--     ('AMINISTRADOR', 'DASHBOARD_EXPORTAR'),
--     ('AMINISTRADOR', 'DASHBOARD_GLOBAL'),
--     ('AMINISTRADOR', 'DASHBOARD_SEDE'),
--     ('AMINISTRADOR', 'DESCUENTOS_ADMINISTRAR'),
--     ('AMINISTRADOR', 'MENU_CHIPS'),
--     ('AMINISTRADOR', 'MENU_CHIPS_INVENTARIO'),
--     ('AMINISTRADOR', 'MENU_CHIPS_TIPOS'),
--     ('AMINISTRADOR', 'MENU_CHIPS_VENTAS'),
--     ('AMINISTRADOR', 'MENU_CONFIGURACION'),
--     ('AMINISTRADOR', 'MENU_CONFIGURACION_CATALOGO'),
--     ('AMINISTRADOR', 'MENU_CONFIGURACION_CORRELATIVOS'),
--     ('AMINISTRADOR', 'MENU_CONFIGURACION_SEDES'),
--     ('AMINISTRADOR', 'MENU_CONFIGURACION_TARIFAS'),
--     ('AMINISTRADOR', 'MENU_DASHBOARD'),
--     ('AMINISTRADOR', 'MENU_DESCUENTOS'),
--     ('AMINISTRADOR', 'MENU_INICIO'),
--     ('CONTADOR', 'MENU_CONFIGURACION'),
--     ('CONTADOR', 'MENU_CONFIGURACION_CORRELATIVOS'),
--     ('CONTADOR', 'MENU_FACTURACION'),
--     ('CONTADOR', 'MENU_FACTURACION_CLIENTES'),
--     ('CONTADOR', 'MENU_FACTURACION_COMPROBANTES'),
--     ('JEFE_PLANTA', 'CHIPS_BAJA'),
--     ('JEFE_PLANTA', 'CHIPS_CONFIGURAR'),
--     ('JEFE_PLANTA', 'CHIPS_INGRESAR'),
--     ('JEFE_PLANTA', 'CHIPS_TRANSFERIR'),
--     ('JEFE_PLANTA', 'CHIPS_VENDER'),
--     ('JEFE_PLANTA', 'CHIPS_VER'),
--     ('JEFE_PLANTA', 'CONFIGURACION_CATEGORIAS'),
--     ('JEFE_PLANTA', 'CONFIGURACION_EMPRESAS'),
--     ('JEFE_PLANTA', 'CONFIGURACION_PRODUCTOS'),
--     ('JEFE_PLANTA', 'CONFIGURACION_SEDES'),
--     ('JEFE_PLANTA', 'CONFIGURACION_SERIES'),
--     ('JEFE_PLANTA', 'CONFIGURACION_SERVICIOS'),
--     ('JEFE_PLANTA', 'CONFIGURACION_TARIFAS'),
--     ('JEFE_PLANTA', 'DESCUENTOS_ADMINISTRAR'),
--     ('JEFE_PLANTA', 'FAREGAS_SOLICITUD_VER'),
--     ('JEFE_PLANTA', 'MENU_CHIPS'),
--     ('JEFE_PLANTA', 'MENU_CHIPS_INVENTARIO'),
--     ('JEFE_PLANTA', 'MENU_CHIPS_TIPOS'),
--     ('JEFE_PLANTA', 'MENU_CHIPS_VENTAS'),
--     ('JEFE_PLANTA', 'MENU_CONFIGURACION_TARIFAS'),
--     ('JEFE_PLANTA', 'MENU_DESCUENTOS'),
--     ('JEFE_PLANTA', 'MENU_INICIO'),
--     ('JEFE_PLANTA', 'MENU_USUARIOS'),
--     ('OPERADOR', 'CHIPS_BAJA'),
--     ('OPERADOR', 'CHIPS_CONFIGURAR'),
--     ('OPERADOR', 'CHIPS_INGRESAR'),
--     ('OPERADOR', 'CHIPS_TRANSFERIR'),
--     ('OPERADOR', 'CHIPS_VENDER'),
--     ('OPERADOR', 'CHIPS_VER'),
--     ('OPERADOR', 'CONFIGURACION_CATEGORIAS'),
--     ('OPERADOR', 'CONFIGURACION_EMPRESAS'),
--     ('OPERADOR', 'CONFIGURACION_PRODUCTOS'),
--     ('OPERADOR', 'CONFIGURACION_SEDES'),
--     ('OPERADOR', 'CONFIGURACION_SERIES'),
--     ('OPERADOR', 'CONFIGURACION_SERVICIOS'),
--     ('OPERADOR', 'CONFIGURACION_TARIFAS'),
--     ('OPERADOR', 'DESCUENTOS_ADMINISTRAR'),
--     ('OPERADOR', 'FAREGAS_SOLICITUD_CREAR'),
--     ('OPERADOR', 'FAREGAS_SOLICITUD_VER'),
--     ('OPERADOR', 'MENU_CHIPS'),
--     ('OPERADOR', 'MENU_CHIPS_VENTAS'),
--     ('OPERADOR', 'MENU_INICIO'),
--     ('SISTEMAS', 'CHIPS_BAJA'),
--     ('SISTEMAS', 'CHIPS_CONFIGURAR'),
--     ('SISTEMAS', 'CHIPS_INGRESAR'),
--     ('SISTEMAS', 'CHIPS_TRANSFERIR'),
--     ('SISTEMAS', 'CHIPS_VENDER'),
--     ('SISTEMAS', 'CHIPS_VER'),
--     ('SISTEMAS', 'CONFIGURACION_CATEGORIAS'),
--     ('SISTEMAS', 'CONFIGURACION_EMPRESAS'),
--     ('SISTEMAS', 'CONFIGURACION_PRODUCTOS'),
--     ('SISTEMAS', 'CONFIGURACION_SEDES'),
--     ('SISTEMAS', 'CONFIGURACION_SERIES'),
--     ('SISTEMAS', 'CONFIGURACION_SERVICIOS'),
--     ('SISTEMAS', 'CONFIGURACION_TARIFAS'),
--     ('SISTEMAS', 'DASHBOARD_EXPORTAR'),
--     ('SISTEMAS', 'DASHBOARD_GLOBAL'),
--     ('SISTEMAS', 'DASHBOARD_SEDE'),
--     ('SISTEMAS', 'DESCUENTOS_ADMINISTRAR'),
--     ('SISTEMAS', 'FAREGAS_ANULAR_COMPROBANTE'),
--     ('SISTEMAS', 'FAREGAS_CERTIFICADO_ANULAR_EJECUTAR'),
--     ('SISTEMAS', 'FAREGAS_CERTIFICADO_RECTIFICAR_EJECUTAR'),
--     ('SISTEMAS', 'FAREGAS_NOTA_CREDITO'),
--     ('SISTEMAS', 'FAREGAS_NOTA_CREDITO_APROBAR'),
--     ('SISTEMAS', 'FAREGAS_NOTA_CREDITO_AUTOAPROBAR'),
--     ('SISTEMAS', 'FAREGAS_SOLICITUD_ADMINISTRAR'),
--     ('SISTEMAS', 'FAREGAS_SOLICITUD_APROBAR'),
--     ('SISTEMAS', 'FAREGAS_SOLICITUD_AUTOAPROBAR'),
--     ('SISTEMAS', 'FAREGAS_SOLICITUD_AUTOEJECUTAR'),
--     ('SISTEMAS', 'FAREGAS_SOLICITUD_CREAR'),
--     ('SISTEMAS', 'FAREGAS_SOLICITUD_RECHAZAR'),
--     ('SISTEMAS', 'FAREGAS_SOLICITUD_VER'),
--     ('SISTEMAS', 'MENU_AUDITORIA'),
--     ('SISTEMAS', 'MENU_CHIPS'),
--     ('SISTEMAS', 'MENU_CHIPS_INVENTARIO'),
--     ('SISTEMAS', 'MENU_CHIPS_TIPOS'),
--     ('SISTEMAS', 'MENU_CHIPS_VENTAS'),
--     ('SISTEMAS', 'MENU_CONFIGURACION'),
--     ('SISTEMAS', 'MENU_CONFIGURACION_CATALOGO'),
--     ('SISTEMAS', 'MENU_CONFIGURACION_CORRELATIVOS'),
--     ('SISTEMAS', 'MENU_CONFIGURACION_EMPRESAS'),
--     ('SISTEMAS', 'MENU_CONFIGURACION_SEDES'),
--     ('SISTEMAS', 'MENU_CONFIGURACION_TARIFAS'),
--     ('SISTEMAS', 'MENU_DASHBOARD'),
--     ('SISTEMAS', 'MENU_DESCUENTOS'),
--     ('SISTEMAS', 'MENU_FACTURACION'),
--     ('SISTEMAS', 'MENU_FACTURACION_CLIENTES'),
--     ('SISTEMAS', 'MENU_FACTURACION_COMPROBANTES'),
--     ('SISTEMAS', 'MENU_FACTURACION_PREPARACION'),
--     ('SISTEMAS', 'MENU_FACTURACION_SERIES'),
--     ('SISTEMAS', 'MENU_INICIO'),
--     ('SISTEMAS', 'MENU_USUARIOS'),
--     ('SUPERVISOR', 'CHIPS_BAJA'),
--     ('SUPERVISOR', 'CHIPS_CONFIGURAR'),
--     ('SUPERVISOR', 'CHIPS_INGRESAR'),
--     ('SUPERVISOR', 'CHIPS_TRANSFERIR'),
--     ('SUPERVISOR', 'CHIPS_VENDER'),
--     ('SUPERVISOR', 'CHIPS_VER'),
--     ('SUPERVISOR', 'CONFIGURACION_CATEGORIAS'),
--     ('SUPERVISOR', 'CONFIGURACION_EMPRESAS'),
--     ('SUPERVISOR', 'CONFIGURACION_PRODUCTOS'),
--     ('SUPERVISOR', 'CONFIGURACION_SEDES'),
--     ('SUPERVISOR', 'CONFIGURACION_SERIES'),
--     ('SUPERVISOR', 'CONFIGURACION_SERVICIOS'),
--     ('SUPERVISOR', 'CONFIGURACION_TARIFAS'),
--     ('SUPERVISOR', 'DASHBOARD_EXPORTAR'),
--     ('SUPERVISOR', 'DASHBOARD_GLOBAL'),
--     ('SUPERVISOR', 'DASHBOARD_SEDE'),
--     ('SUPERVISOR', 'DESCUENTOS_ADMINISTRAR'),
--     ('SUPERVISOR', 'FAREGAS_ANULAR_COMPROBANTE'),
--     ('SUPERVISOR', 'FAREGAS_CERTIFICADO_ANULAR_EJECUTAR'),
--     ('SUPERVISOR', 'FAREGAS_CERTIFICADO_RECTIFICAR_EJECUTAR'),
--     ('SUPERVISOR', 'FAREGAS_NOTA_CREDITO'),
--     ('SUPERVISOR', 'FAREGAS_SOLICITUD_ADMINISTRAR'),
--     ('SUPERVISOR', 'FAREGAS_SOLICITUD_APROBAR'),
--     ('SUPERVISOR', 'FAREGAS_SOLICITUD_AUTOAPROBAR'),
--     ('SUPERVISOR', 'FAREGAS_SOLICITUD_AUTOEJECUTAR'),
--     ('SUPERVISOR', 'FAREGAS_SOLICITUD_CREAR'),
--     ('SUPERVISOR', 'FAREGAS_SOLICITUD_RECHAZAR'),
--     ('SUPERVISOR', 'FAREGAS_SOLICITUD_VER'),
--     ('SUPERVISOR', 'MENU_CHIPS'),
--     ('SUPERVISOR', 'MENU_CHIPS_INVENTARIO'),
--     ('SUPERVISOR', 'MENU_CHIPS_VENTAS'),
--     ('SUPERVISOR', 'MENU_CONFIGURACION_TARIFAS'),
--     ('SUPERVISOR', 'MENU_DASHBOARD'),
--     ('SUPERVISOR', 'MENU_INICIO')
-- ON CONFLICT (perfil_clave, permiso_clave) DO NOTHING;
-- -- END CATALOGO_RBAC_FAREGAS_GENERADO
--
-- COMMIT;
