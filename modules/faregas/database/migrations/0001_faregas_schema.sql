-- ============================================================================
-- FAREGAS - ESQUEMA CONSOLIDADO
-- Generado desde el esquema operativo verificado el 2026-10-19.
-- Contiene 61 tablas funcionales, secuencias, claves, restricciones, indices,
-- comentarios, funcion, trigger y la unica cuenta bancaria operativa FAREGAS.
--
-- Prerrequisito: el esquema legacy Farenet debe existir porque FAREGAS conserva
-- claves foraneas hacia moneda, formapago, cuentacorriente, entidadfinanciera,
-- tarjeta, tipocontado y persona.
--
-- Sustituye las migraciones incrementales 20200101-20261019. El historial fue
-- movido a database/migrations_history y no debe ejecutarse despues de este
-- archivo consolidado.
-- ============================================================================

BEGIN;

--
-- PostgreSQL database dump
--

-- Dumped from database version 13.23
-- Dumped by pg_dump version 16.4

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


-- Cuenta bancaria exclusiva de FAREGAS. Se guarda en el catalogo legacy para
-- conservar la FK de fg_pago, pero empresa_key permite excluirla de FARENET.
-- Cuenta: 0100020564. CCI informativo: 011-397-000100020564-79.
-- El UPSERT hace segura la reinstalacion de esta configuracion maestra.
INSERT INTO public.cuentacorriente (
    key,
    nroctacorriente,
    entidadfinanciera_key,
    moneda_key,
    enable,
    empresa_key
) VALUES (
    'FG_BBVA_00020564',
    '0011-0397-0100020564',
    '6',
    'sol',
    TRUE,
    'FAREGAS'
)
ON CONFLICT (key) DO UPDATE SET
    nroctacorriente = EXCLUDED.nroctacorriente,
    entidadfinanciera_key = EXCLUDED.entidadfinanciera_key,
    moneda_key = EXCLUDED.moneda_key,
    enable = EXCLUDED.enable,
    empresa_key = EXCLUDED.empresa_key;


-- Funcion requerida por el trigger inmutable del inventario por cantidad.
CREATE OR REPLACE FUNCTION public.fg_bloquear_mutacion_movimiento_inventario_cantidad()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
    RAISE EXCEPTION 'Los movimientos de inventario por cantidad son inmutables';
END;
$function$;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: fg_auditoria_acceso; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fg_auditoria_acceso (
    id bigint NOT NULL,
    username character varying(255),
    evento character varying(50) NOT NULL,
    exitoso boolean NOT NULL,
    mensaje text,
    planta_key character varying(20),
    ip_direccion character varying(45),
    user_agent character varying(1000),
    fecha_evento timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    categoria character varying(30) DEFAULT 'ACCESO'::character varying NOT NULL,
    entidad character varying(50),
    entidad_id bigint,
    certificado_id bigint,
    numero_certificado character varying(80),
    placa character varying(20),
    tipo_certificado character varying(50),
    paso character varying(50),
    datos jsonb,
    perfil character varying(50)
);


--
-- Name: TABLE fg_auditoria_acceso; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.fg_auditoria_acceso IS 'Bitácora inmutable de accesos y operaciones relevantes del subsistema FAREGAS';


--
-- Name: COLUMN fg_auditoria_acceso.datos; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.fg_auditoria_acceso.datos IS 'Resumen técnico no sensible del evento; no debe almacenar contraseñas, tokens ni datos completos de pago';


--
-- Name: COLUMN fg_auditoria_acceso.perfil; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.fg_auditoria_acceso.perfil IS 'Perfil histórico que tenía el usuario al momento de la operación';


--
-- Name: fg_auditoria_acceso_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.fg_auditoria_acceso_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: fg_auditoria_acceso_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.fg_auditoria_acceso_id_seq OWNED BY public.fg_auditoria_acceso.id;


--
-- Name: fg_auditoria_config; Type: TABLE; Schema: public; Owner: -
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
-- Name: fg_auditoria_config_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.fg_auditoria_config_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: fg_auditoria_config_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.fg_auditoria_config_id_seq OWNED BY public.fg_auditoria_config.id;


--
-- Name: fg_categoria_servicio; Type: TABLE; Schema: public; Owner: -
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
-- Name: fg_categoria_servicio_id_seq; Type: SEQUENCE; Schema: public; Owner: -
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
-- Name: fg_certificado; Type: TABLE; Schema: public; Owner: -
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
    CONSTRAINT ck_fg_certificado_paso_actual CHECK (((paso_actual)::text = ANY ((ARRAY['DATOS_INICIALES'::character varying, 'PAGO'::character varying, 'VEHICULO'::character varying, 'FACTURACION'::character varying, 'PREVISUALIZACION'::character varying, 'VERIFICACION_EMISION'::character varying])::text[])))
);


--
-- Name: fg_certificado_chip; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fg_certificado_chip (
    certificado_id bigint NOT NULL,
    chip_id bigint NOT NULL,
    fecha_asociacion timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: fg_certificado_conformidad; Type: TABLE; Schema: public; Owner: -
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
-- Name: fg_certificado_formato; Type: TABLE; Schema: public; Owner: -
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
-- Name: fg_certificado_formato_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.fg_certificado_formato_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: fg_certificado_formato_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.fg_certificado_formato_id_seq OWNED BY public.fg_certificado_formato.id;


--
-- Name: fg_certificado_formato_version; Type: TABLE; Schema: public; Owner: -
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
-- Name: fg_certificado_formato_version_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.fg_certificado_formato_version_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: fg_certificado_formato_version_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.fg_certificado_formato_version_id_seq OWNED BY public.fg_certificado_formato_version.id;


--
-- Name: fg_certificado_glp; Type: TABLE; Schema: public; Owner: -
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
-- Name: fg_certificado_glp_componente; Type: TABLE; Schema: public; Owner: -
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
-- Name: fg_certificado_glp_componente_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.fg_certificado_glp_componente_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: fg_certificado_glp_componente_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.fg_certificado_glp_componente_id_seq OWNED BY public.fg_certificado_glp_componente.id;


--
-- Name: fg_certificado_glp_verificacion; Type: TABLE; Schema: public; Owner: -
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
-- Name: fg_certificado_glp_verificacion_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.fg_certificado_glp_verificacion_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: fg_certificado_glp_verificacion_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.fg_certificado_glp_verificacion_id_seq OWNED BY public.fg_certificado_glp_verificacion.id;


--
-- Name: fg_certificado_gnv; Type: TABLE; Schema: public; Owner: -
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
-- Name: COLUMN fg_certificado_gnv.observaciones; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.fg_certificado_gnv.observaciones IS 'Observaciones del certificado GNV escritas por el inspector. Opcional. Limite 250 caracteres.';


--
-- Name: fg_certificado_gnv_componente; Type: TABLE; Schema: public; Owner: -
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
-- Name: fg_certificado_gnv_componente_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.fg_certificado_gnv_componente_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: fg_certificado_gnv_componente_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.fg_certificado_gnv_componente_id_seq OWNED BY public.fg_certificado_gnv_componente.id;


--
-- Name: fg_certificado_gnv_verificacion; Type: TABLE; Schema: public; Owner: -
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
-- Name: fg_certificado_gnv_verificacion_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.fg_certificado_gnv_verificacion_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: fg_certificado_gnv_verificacion_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.fg_certificado_gnv_verificacion_id_seq OWNED BY public.fg_certificado_gnv_verificacion.id;


--
-- Name: fg_certificado_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.fg_certificado_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: fg_certificado_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.fg_certificado_id_seq OWNED BY public.fg_certificado.id;


--
-- Name: fg_certificado_titular; Type: TABLE; Schema: public; Owner: -
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
-- Name: fg_certificado_titular_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.fg_certificado_titular_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: fg_certificado_titular_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.fg_certificado_titular_id_seq OWNED BY public.fg_certificado_titular.id;


--
-- Name: fg_certificado_vehiculo; Type: TABLE; Schema: public; Owner: -
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
-- Name: fg_chip; Type: TABLE; Schema: public; Owner: -
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
-- Name: fg_chip_id_seq; Type: SEQUENCE; Schema: public; Owner: -
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
-- Name: fg_chip_movimiento; Type: TABLE; Schema: public; Owner: -
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
-- Name: fg_chip_movimiento_id_seq; Type: SEQUENCE; Schema: public; Owner: -
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
-- Name: fg_cliente; Type: TABLE; Schema: public; Owner: -
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
-- Name: fg_cliente_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.fg_cliente_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: fg_cliente_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.fg_cliente_id_seq OWNED BY public.fg_cliente.id;


--
-- Name: fg_correlativo_certificado; Type: TABLE; Schema: public; Owner: -
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
-- Name: TABLE fg_correlativo_certificado; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.fg_correlativo_certificado IS 'Rangos de numeracion de certificados FAREGAS por sede, tipo y modalidad. Los rangos 100000+ son provisionales de desarrollo.';


--
-- Name: COLUMN fg_correlativo_certificado.modalidad; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.fg_correlativo_certificado.modalidad IS 'Modalidad exacta del rango: INICIAL, ANUAL o UNICA para Conformidad.';


--
-- Name: fg_correlativo_certificado_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.fg_correlativo_certificado_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: fg_correlativo_certificado_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.fg_correlativo_certificado_id_seq OWNED BY public.fg_correlativo_certificado.id;


--
-- Name: fg_correlativo_certificado_sede; Type: TABLE; Schema: public; Owner: -
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
-- Name: fg_correlativo_certificado_sede_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.fg_correlativo_certificado_sede_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: fg_correlativo_certificado_sede_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.fg_correlativo_certificado_sede_id_seq OWNED BY public.fg_correlativo_certificado_sede.id;


--
-- Name: fg_credito; Type: TABLE; Schema: public; Owner: -
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
    CONSTRAINT ck_fg_credito_estado CHECK (((estado)::text = ANY ((ARRAY['BORRADOR'::character varying, 'PENDIENTE'::character varying, 'ACEPTADO'::character varying, 'RECHAZADO'::character varying, 'ERROR'::character varying, 'ANULADO'::character varying])::text[]))),
    CONSTRAINT ck_fg_credito_importes CHECK (((base_imponible >= (0)::numeric) AND (igv >= (0)::numeric) AND (importe_total >= (0)::numeric))),
    CONSTRAINT ck_fg_credito_numero CHECK (((numero IS NULL) OR (numero > 0)))
);


--
-- Name: fg_credito_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.fg_credito_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: fg_credito_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.fg_credito_id_seq OWNED BY public.fg_credito.id;


--
-- Name: fg_debito; Type: TABLE; Schema: public; Owner: -
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
-- Name: fg_debito_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.fg_debito_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: fg_debito_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.fg_debito_id_seq OWNED BY public.fg_debito.id;


--
-- Name: fg_descuento; Type: TABLE; Schema: public; Owner: -
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
-- Name: COLUMN fg_descuento.tipo; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.fg_descuento.tipo IS 'Tipo de campaña FAREGAS: CAMPANA, ALIANZA, CONVENIO o PROMOCION';


--
-- Name: COLUMN fg_descuento.ejecutivo; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.fg_descuento.ejecutivo IS 'Nombre histórico del ejecutivo al momento de registrar el descuento';


--
-- Name: COLUMN fg_descuento.ejecutivo_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.fg_descuento.ejecutivo_id IS 'Ejecutivo FAREGAS relacionado con la alianza';


--
-- Name: fg_descuento_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.fg_descuento_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: fg_descuento_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.fg_descuento_id_seq OWNED BY public.fg_descuento.id;


--
-- Name: fg_descuentocliente; Type: TABLE; Schema: public; Owner: -
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
-- Name: fg_descuentocliente_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.fg_descuentocliente_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: fg_descuentocliente_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.fg_descuentocliente_id_seq OWNED BY public.fg_descuentocliente.id;


--
-- Name: fg_descuentocomprobante; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fg_descuentocomprobante (
    id bigint NOT NULL,
    descuento_cliente_id bigint NOT NULL,
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
    CONSTRAINT chk_fg_descom_estado CHECK (((estado)::text = ANY ((ARRAY['RESERVADO'::character varying, 'APLICADO'::character varying, 'LIBERADO'::character varying, 'ANULADO'::character varying])::text[]))),
    CONSTRAINT chk_fg_descom_importes CHECK (((importe_original >= importe_descuento) AND (importe_final = (importe_original - importe_descuento)) AND (importe_final >= (0)::numeric)))
);


--
-- Name: fg_descuentocomprobante_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.fg_descuentocomprobante_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: fg_descuentocomprobante_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.fg_descuentocomprobante_id_seq OWNED BY public.fg_descuentocomprobante.id;


--
-- Name: fg_descuentodetalle; Type: TABLE; Schema: public; Owner: -
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
-- Name: fg_descuentodetalle_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.fg_descuentodetalle_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: fg_descuentodetalle_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.fg_descuentodetalle_id_seq OWNED BY public.fg_descuentodetalle.id;


--
-- Name: fg_documento_anulacion; Type: TABLE; Schema: public; Owner: -
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
-- Name: fg_documento_anulacion_id_seq; Type: SEQUENCE; Schema: public; Owner: -
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
-- Name: fg_documento_electronico_operacion; Type: TABLE; Schema: public; Owner: -
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
-- Name: fg_documento_electronico_operacion_id_seq; Type: SEQUENCE; Schema: public; Owner: -
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
-- Name: fg_ejecutivo; Type: TABLE; Schema: public; Owner: -
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
-- Name: TABLE fg_ejecutivo; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.fg_ejecutivo IS 'Catálogo de colaboradores responsables de alianzas FAREGAS';


--
-- Name: fg_ejecutivo_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.fg_ejecutivo_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: fg_ejecutivo_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.fg_ejecutivo_id_seq OWNED BY public.fg_ejecutivo.id;


--
-- Name: fg_empresa; Type: TABLE; Schema: public; Owner: -
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
-- Name: fg_empresa_facturador; Type: TABLE; Schema: public; Owner: -
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
-- Name: COLUMN fg_empresa_facturador.credencial_clave; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.fg_empresa_facturador.credencial_clave IS 'Identificador de variables de entorno; nunca contiene ruta ni token.';


--
-- Name: fg_empresa_facturador_id_seq; Type: SEQUENCE; Schema: public; Owner: -
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
-- Name: fg_facturacion; Type: TABLE; Schema: public; Owner: -
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
-- Name: COLUMN fg_facturacion.codigo_unico; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.fg_facturacion.codigo_unico IS 'Idempotencia Nubefact estable para todos los reintentos de una facturacion.';


--
-- Name: fg_facturacion_cuota; Type: TABLE; Schema: public; Owner: -
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
-- Name: fg_facturacion_cuota_id_seq; Type: SEQUENCE; Schema: public; Owner: -
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
-- Name: fg_facturacion_id_seq; Type: SEQUENCE; Schema: public; Owner: -
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
-- Name: fg_facturacion_intento; Type: TABLE; Schema: public; Owner: -
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
-- Name: fg_facturacion_intento_id_seq; Type: SEQUENCE; Schema: public; Owner: -
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
-- Name: fg_inventario_cantidad_movimiento; Type: TABLE; Schema: public; Owner: -
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
-- Name: fg_inventario_cantidad_movimiento_id_seq; Type: SEQUENCE; Schema: public; Owner: -
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
-- Name: fg_operacion_comercial; Type: TABLE; Schema: public; Owner: -
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
-- Name: fg_operacion_comercial_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.fg_operacion_comercial_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: fg_operacion_comercial_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.fg_operacion_comercial_id_seq OWNED BY public.fg_operacion_comercial.id;


--
-- Name: fg_operacion_detalle; Type: TABLE; Schema: public; Owner: -
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
-- Name: fg_operacion_detalle_chip; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fg_operacion_detalle_chip (
    operacion_detalle_id bigint NOT NULL,
    chip_id bigint NOT NULL
);


--
-- Name: fg_operacion_detalle_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.fg_operacion_detalle_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: fg_operacion_detalle_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.fg_operacion_detalle_id_seq OWNED BY public.fg_operacion_detalle.id;


--
-- Name: fg_orden_pago; Type: TABLE; Schema: public; Owner: -
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
-- Name: COLUMN fg_orden_pago.fecha_inicio_credito; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.fg_orden_pago.fecha_inicio_credito IS 'Fecha inicial del período de crédito capturada en el paso Pago.';


--
-- Name: COLUMN fg_orden_pago.fecha_vencimiento_credito; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.fg_orden_pago.fecha_vencimiento_credito IS 'Fecha final del período de crédito capturada en el paso Pago.';


--
-- Name: fg_orden_pago_id_seq; Type: SEQUENCE; Schema: public; Owner: -
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
-- Name: fg_pago; Type: TABLE; Schema: public; Owner: -
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
-- Name: fg_pago_id_seq; Type: SEQUENCE; Schema: public; Owner: -
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
-- Name: fg_perfil; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fg_perfil (
    clave character varying(255) NOT NULL,
    nombre character varying(255) NOT NULL,
    visible boolean
);


--
-- Name: fg_perfil_permiso; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fg_perfil_permiso (
    perfil_clave character varying(255) NOT NULL,
    permiso_clave character varying(100) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: fg_perfil_planta; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fg_perfil_planta (
    perfil_clave character varying(255) NOT NULL,
    planta_key character varying(20) NOT NULL
);


--
-- Name: fg_permiso; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fg_permiso (
    clave character varying(100) NOT NULL,
    nombre character varying(200) NOT NULL,
    modulo character varying(100) NOT NULL,
    descripcion text,
    activo boolean DEFAULT true NOT NULL
);


--
-- Name: fg_planta; Type: TABLE; Schema: public; Owner: -
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
-- Name: fg_producto_facturacion; Type: TABLE; Schema: public; Owner: -
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
-- Name: COLUMN fg_producto_facturacion.precio_referencia; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.fg_producto_facturacion.precio_referencia IS 'Precio de venta unitario del maestro comercial; no reemplaza la tarifa por sede.';


--
-- Name: COLUMN fg_producto_facturacion.categoria_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.fg_producto_facturacion.categoria_id IS 'Categoría funcional principal del producto fiscal. Puede ser NULL solo para datos históricos pendientes de clasificación.';


--
-- Name: COLUMN fg_producto_facturacion.codigo_barras; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.fg_producto_facturacion.codigo_barras IS 'Código de barras opcional proveniente del maestro comercial DMS.';


--
-- Name: COLUMN fg_producto_facturacion.codigo_afectacion_isc; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.fg_producto_facturacion.codigo_afectacion_isc IS 'Código de afectación ISC opcional del maestro fiscal DMS.';


--
-- Name: COLUMN fg_producto_facturacion.imagen_url; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.fg_producto_facturacion.imagen_url IS 'URL opcional de la imagen del producto; no almacena binarios.';


--
-- Name: fg_producto_facturacion_id_seq; Type: SEQUENCE; Schema: public; Owner: -
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
-- Name: fg_producto_inventariable; Type: TABLE; Schema: public; Owner: -
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
    CONSTRAINT ck_fg_producto_inventariable_codigo CHECK ((btrim((codigo)::text) <> ''::text)),
    CONSTRAINT ck_fg_producto_inventariable_nombre CHECK ((btrim((nombre)::text) <> ''::text))
);


--
-- Name: fg_producto_inventariable_id_seq; Type: SEQUENCE; Schema: public; Owner: -
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
-- Name: fg_producto_inventariable_sede; Type: TABLE; Schema: public; Owner: -
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
-- Name: fg_producto_inventariable_sede_id_seq; Type: SEQUENCE; Schema: public; Owner: -
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
-- Name: fg_producto_sede; Type: TABLE; Schema: public; Owner: -
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
-- Name: fg_producto_sede_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.fg_producto_sede_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: fg_producto_sede_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.fg_producto_sede_id_seq OWNED BY public.fg_producto_sede.id;


--
-- Name: fg_serie_comprobante; Type: TABLE; Schema: public; Owner: -
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
-- Name: fg_serie_comprobante_id_seq; Type: SEQUENCE; Schema: public; Owner: -
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
-- Name: fg_servicio; Type: TABLE; Schema: public; Owner: -
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
    CONSTRAINT ck_fg_servicio_tipo_flujo CHECK (((tipo_flujo)::text = ANY ((ARRAY['CERTIFICACION'::character varying, 'SERVICIO_COMPLEMENTARIO'::character varying, 'VEHICULAR_EXISTENTE'::character varying, 'TALLER_INSPECCION'::character varying, 'PRODUCTO_SOLAMENTE'::character varying])::text[])))
);


--
-- Name: fg_servicio_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.fg_servicio_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: fg_servicio_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.fg_servicio_id_seq OWNED BY public.fg_servicio.id;


--
-- Name: fg_taller_autorizado; Type: TABLE; Schema: public; Owner: -
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
-- Name: fg_taller_autorizado_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.fg_taller_autorizado_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: fg_taller_autorizado_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.fg_taller_autorizado_id_seq OWNED BY public.fg_taller_autorizado.id;


--
-- Name: fg_tarifa; Type: TABLE; Schema: public; Owner: -
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
-- Name: fg_tarifa_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.fg_tarifa_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: fg_tarifa_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.fg_tarifa_id_seq OWNED BY public.fg_tarifa.id;


--
-- Name: fg_tipo_certificado; Type: TABLE; Schema: public; Owner: -
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
-- Name: fg_usuario; Type: TABLE; Schema: public; Owner: -
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
-- Name: fg_usuario_planta; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fg_usuario_planta (
    usuario_username character varying(255) NOT NULL,
    plantas_key character varying(20) NOT NULL
);


--
-- Name: fg_usuario_sesion; Type: TABLE; Schema: public; Owner: -
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
-- Name: fg_usuario_sesion_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.fg_usuario_sesion_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: fg_usuario_sesion_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.fg_usuario_sesion_id_seq OWNED BY public.fg_usuario_sesion.id;


--
-- Name: fg_vehiculo; Type: TABLE; Schema: public; Owner: -
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
-- Name: fg_vehiculo_id_seq; Type: SEQUENCE; Schema: public; Owner: -
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
-- Name: fg_venta; Type: TABLE; Schema: public; Owner: -
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
-- Name: fg_venta_detalle; Type: TABLE; Schema: public; Owner: -
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
-- Name: fg_venta_detalle_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.fg_venta_detalle_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: fg_venta_detalle_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.fg_venta_detalle_id_seq OWNED BY public.fg_venta_detalle.id;


--
-- Name: fg_venta_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.fg_venta_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: fg_venta_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.fg_venta_id_seq OWNED BY public.fg_venta.id;


--
-- Name: fg_auditoria_acceso id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_auditoria_acceso ALTER COLUMN id SET DEFAULT nextval('public.fg_auditoria_acceso_id_seq'::regclass);


--
-- Name: fg_auditoria_config id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_auditoria_config ALTER COLUMN id SET DEFAULT nextval('public.fg_auditoria_config_id_seq'::regclass);


--
-- Name: fg_certificado id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_certificado ALTER COLUMN id SET DEFAULT nextval('public.fg_certificado_id_seq'::regclass);


--
-- Name: fg_certificado_formato id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_certificado_formato ALTER COLUMN id SET DEFAULT nextval('public.fg_certificado_formato_id_seq'::regclass);


--
-- Name: fg_certificado_formato_version id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_certificado_formato_version ALTER COLUMN id SET DEFAULT nextval('public.fg_certificado_formato_version_id_seq'::regclass);


--
-- Name: fg_certificado_glp_componente id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_certificado_glp_componente ALTER COLUMN id SET DEFAULT nextval('public.fg_certificado_glp_componente_id_seq'::regclass);


--
-- Name: fg_certificado_glp_verificacion id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_certificado_glp_verificacion ALTER COLUMN id SET DEFAULT nextval('public.fg_certificado_glp_verificacion_id_seq'::regclass);


--
-- Name: fg_certificado_gnv_componente id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_certificado_gnv_componente ALTER COLUMN id SET DEFAULT nextval('public.fg_certificado_gnv_componente_id_seq'::regclass);


--
-- Name: fg_certificado_gnv_verificacion id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_certificado_gnv_verificacion ALTER COLUMN id SET DEFAULT nextval('public.fg_certificado_gnv_verificacion_id_seq'::regclass);


--
-- Name: fg_certificado_titular id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_certificado_titular ALTER COLUMN id SET DEFAULT nextval('public.fg_certificado_titular_id_seq'::regclass);


--
-- Name: fg_cliente id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_cliente ALTER COLUMN id SET DEFAULT nextval('public.fg_cliente_id_seq'::regclass);


--
-- Name: fg_correlativo_certificado id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_correlativo_certificado ALTER COLUMN id SET DEFAULT nextval('public.fg_correlativo_certificado_id_seq'::regclass);


--
-- Name: fg_correlativo_certificado_sede id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_correlativo_certificado_sede ALTER COLUMN id SET DEFAULT nextval('public.fg_correlativo_certificado_sede_id_seq'::regclass);


--
-- Name: fg_credito id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_credito ALTER COLUMN id SET DEFAULT nextval('public.fg_credito_id_seq'::regclass);


--
-- Name: fg_debito id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_debito ALTER COLUMN id SET DEFAULT nextval('public.fg_debito_id_seq'::regclass);


--
-- Name: fg_descuento id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_descuento ALTER COLUMN id SET DEFAULT nextval('public.fg_descuento_id_seq'::regclass);


--
-- Name: fg_descuentocliente id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_descuentocliente ALTER COLUMN id SET DEFAULT nextval('public.fg_descuentocliente_id_seq'::regclass);


--
-- Name: fg_descuentocomprobante id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_descuentocomprobante ALTER COLUMN id SET DEFAULT nextval('public.fg_descuentocomprobante_id_seq'::regclass);


--
-- Name: fg_descuentodetalle id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_descuentodetalle ALTER COLUMN id SET DEFAULT nextval('public.fg_descuentodetalle_id_seq'::regclass);


--
-- Name: fg_ejecutivo id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_ejecutivo ALTER COLUMN id SET DEFAULT nextval('public.fg_ejecutivo_id_seq'::regclass);


--
-- Name: fg_operacion_comercial id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_operacion_comercial ALTER COLUMN id SET DEFAULT nextval('public.fg_operacion_comercial_id_seq'::regclass);


--
-- Name: fg_operacion_detalle id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_operacion_detalle ALTER COLUMN id SET DEFAULT nextval('public.fg_operacion_detalle_id_seq'::regclass);


--
-- Name: fg_producto_sede id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_producto_sede ALTER COLUMN id SET DEFAULT nextval('public.fg_producto_sede_id_seq'::regclass);


--
-- Name: fg_servicio id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_servicio ALTER COLUMN id SET DEFAULT nextval('public.fg_servicio_id_seq'::regclass);


--
-- Name: fg_taller_autorizado id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_taller_autorizado ALTER COLUMN id SET DEFAULT nextval('public.fg_taller_autorizado_id_seq'::regclass);


--
-- Name: fg_tarifa id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_tarifa ALTER COLUMN id SET DEFAULT nextval('public.fg_tarifa_id_seq'::regclass);


--
-- Name: fg_usuario_sesion id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_usuario_sesion ALTER COLUMN id SET DEFAULT nextval('public.fg_usuario_sesion_id_seq'::regclass);


--
-- Name: fg_venta id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_venta ALTER COLUMN id SET DEFAULT nextval('public.fg_venta_id_seq'::regclass);


--
-- Name: fg_venta_detalle id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_venta_detalle ALTER COLUMN id SET DEFAULT nextval('public.fg_venta_detalle_id_seq'::regclass);


--
-- Name: fg_correlativo_certificado_sede excl_fg_corr_sede_rango; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_correlativo_certificado_sede
    ADD CONSTRAINT excl_fg_corr_sede_rango EXCLUDE USING gist (int8range(rango_inicio, rango_fin, '[]'::text) WITH &&);


--
-- Name: fg_correlativo_certificado excl_fg_correlativo_rango; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_correlativo_certificado
    ADD CONSTRAINT excl_fg_correlativo_rango EXCLUDE USING gist (tipo_certificado_clave WITH =, int8range(nro_inicio, nro_maximo, '[]'::text) WITH &&);


--
-- Name: fg_auditoria_acceso fg_auditoria_acceso_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_auditoria_acceso
    ADD CONSTRAINT fg_auditoria_acceso_pkey PRIMARY KEY (id);


--
-- Name: fg_auditoria_config fg_auditoria_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_auditoria_config
    ADD CONSTRAINT fg_auditoria_config_pkey PRIMARY KEY (id);


--
-- Name: fg_categoria_servicio fg_categoria_servicio_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_categoria_servicio
    ADD CONSTRAINT fg_categoria_servicio_pkey PRIMARY KEY (id);


--
-- Name: fg_certificado_chip fg_certificado_chip_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_certificado_chip
    ADD CONSTRAINT fg_certificado_chip_pkey PRIMARY KEY (certificado_id, chip_id);


--
-- Name: fg_certificado_conformidad fg_certificado_conformidad_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_certificado_conformidad
    ADD CONSTRAINT fg_certificado_conformidad_pkey PRIMARY KEY (certificado_id);


--
-- Name: fg_certificado_formato fg_certificado_formato_codigo_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_certificado_formato
    ADD CONSTRAINT fg_certificado_formato_codigo_key UNIQUE (codigo);


--
-- Name: fg_certificado_formato fg_certificado_formato_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_certificado_formato
    ADD CONSTRAINT fg_certificado_formato_pkey PRIMARY KEY (id);


--
-- Name: fg_certificado_formato_version fg_certificado_formato_version_formato_id_version_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_certificado_formato_version
    ADD CONSTRAINT fg_certificado_formato_version_formato_id_version_key UNIQUE (formato_id, version);


--
-- Name: fg_certificado_formato_version fg_certificado_formato_version_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_certificado_formato_version
    ADD CONSTRAINT fg_certificado_formato_version_pkey PRIMARY KEY (id);


--
-- Name: fg_certificado_glp_componente fg_certificado_glp_componente_certificado_id_orden_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_certificado_glp_componente
    ADD CONSTRAINT fg_certificado_glp_componente_certificado_id_orden_key UNIQUE (certificado_id, orden);


--
-- Name: fg_certificado_glp_componente fg_certificado_glp_componente_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_certificado_glp_componente
    ADD CONSTRAINT fg_certificado_glp_componente_pkey PRIMARY KEY (id);


--
-- Name: fg_certificado_glp fg_certificado_glp_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_certificado_glp
    ADD CONSTRAINT fg_certificado_glp_pkey PRIMARY KEY (certificado_id);


--
-- Name: fg_certificado_glp_verificacion fg_certificado_glp_verificacion_certificado_id_codigo_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_certificado_glp_verificacion
    ADD CONSTRAINT fg_certificado_glp_verificacion_certificado_id_codigo_key UNIQUE (certificado_id, codigo);


--
-- Name: fg_certificado_glp_verificacion fg_certificado_glp_verificacion_certificado_id_orden_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_certificado_glp_verificacion
    ADD CONSTRAINT fg_certificado_glp_verificacion_certificado_id_orden_key UNIQUE (certificado_id, orden);


--
-- Name: fg_certificado_glp_verificacion fg_certificado_glp_verificacion_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_certificado_glp_verificacion
    ADD CONSTRAINT fg_certificado_glp_verificacion_pkey PRIMARY KEY (id);


--
-- Name: fg_certificado_gnv_componente fg_certificado_gnv_componente_certificado_id_orden_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_certificado_gnv_componente
    ADD CONSTRAINT fg_certificado_gnv_componente_certificado_id_orden_key UNIQUE (certificado_id, orden);


--
-- Name: fg_certificado_gnv_componente fg_certificado_gnv_componente_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_certificado_gnv_componente
    ADD CONSTRAINT fg_certificado_gnv_componente_pkey PRIMARY KEY (id);


--
-- Name: fg_certificado_gnv fg_certificado_gnv_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_certificado_gnv
    ADD CONSTRAINT fg_certificado_gnv_pkey PRIMARY KEY (certificado_id);


--
-- Name: fg_certificado_gnv_verificacion fg_certificado_gnv_verificacion_certificado_id_codigo_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_certificado_gnv_verificacion
    ADD CONSTRAINT fg_certificado_gnv_verificacion_certificado_id_codigo_key UNIQUE (certificado_id, codigo);


--
-- Name: fg_certificado_gnv_verificacion fg_certificado_gnv_verificacion_certificado_id_orden_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_certificado_gnv_verificacion
    ADD CONSTRAINT fg_certificado_gnv_verificacion_certificado_id_orden_key UNIQUE (certificado_id, orden);


--
-- Name: fg_certificado_gnv_verificacion fg_certificado_gnv_verificacion_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_certificado_gnv_verificacion
    ADD CONSTRAINT fg_certificado_gnv_verificacion_pkey PRIMARY KEY (id);


--
-- Name: fg_certificado fg_certificado_numero_certificado_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_certificado
    ADD CONSTRAINT fg_certificado_numero_certificado_key UNIQUE (numero_certificado);


--
-- Name: fg_certificado fg_certificado_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_certificado
    ADD CONSTRAINT fg_certificado_pkey PRIMARY KEY (id);


--
-- Name: fg_certificado_titular fg_certificado_titular_certificado_id_orden_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_certificado_titular
    ADD CONSTRAINT fg_certificado_titular_certificado_id_orden_key UNIQUE (certificado_id, orden);


--
-- Name: fg_certificado_titular fg_certificado_titular_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_certificado_titular
    ADD CONSTRAINT fg_certificado_titular_pkey PRIMARY KEY (id);


--
-- Name: fg_certificado_vehiculo fg_certificado_vehiculo_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_certificado_vehiculo
    ADD CONSTRAINT fg_certificado_vehiculo_pkey PRIMARY KEY (certificado_id);


--
-- Name: fg_chip_movimiento fg_chip_movimiento_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_chip_movimiento
    ADD CONSTRAINT fg_chip_movimiento_pkey PRIMARY KEY (id);


--
-- Name: fg_chip fg_chip_numero_chip_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_chip
    ADD CONSTRAINT fg_chip_numero_chip_key UNIQUE (numero_chip);


--
-- Name: fg_chip fg_chip_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_chip
    ADD CONSTRAINT fg_chip_pkey PRIMARY KEY (id);


--
-- Name: fg_cliente fg_cliente_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_cliente
    ADD CONSTRAINT fg_cliente_pkey PRIMARY KEY (id);


--
-- Name: fg_cliente fg_cliente_tipo_documento_nro_documento_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_cliente
    ADD CONSTRAINT fg_cliente_tipo_documento_nro_documento_key UNIQUE (tipo_documento, nro_documento);


--
-- Name: fg_correlativo_certificado fg_correlativo_certificado_hist_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_correlativo_certificado
    ADD CONSTRAINT fg_correlativo_certificado_hist_key UNIQUE (planta_key, tipo_certificado_clave, modalidad, nro_inicio, nro_maximo);


--
-- Name: fg_correlativo_certificado fg_correlativo_certificado_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_correlativo_certificado
    ADD CONSTRAINT fg_correlativo_certificado_pkey PRIMARY KEY (id);


--
-- Name: fg_correlativo_certificado_sede fg_correlativo_certificado_sede_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_correlativo_certificado_sede
    ADD CONSTRAINT fg_correlativo_certificado_sede_pkey PRIMARY KEY (id);


--
-- Name: fg_credito fg_credito_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_credito
    ADD CONSTRAINT fg_credito_pkey PRIMARY KEY (id);


--
-- Name: fg_debito fg_debito_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_debito
    ADD CONSTRAINT fg_debito_pkey PRIMARY KEY (id);


--
-- Name: fg_descuento fg_descuento_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_descuento
    ADD CONSTRAINT fg_descuento_pkey PRIMARY KEY (id);


--
-- Name: fg_descuentocliente fg_descuentocliente_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_descuentocliente
    ADD CONSTRAINT fg_descuentocliente_pkey PRIMARY KEY (id);


--
-- Name: fg_descuentocomprobante fg_descuentocomprobante_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_descuentocomprobante
    ADD CONSTRAINT fg_descuentocomprobante_pkey PRIMARY KEY (id);


--
-- Name: fg_descuentodetalle fg_descuentodetalle_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_descuentodetalle
    ADD CONSTRAINT fg_descuentodetalle_pkey PRIMARY KEY (id);


--
-- Name: fg_documento_anulacion fg_documento_anulacion_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_documento_anulacion
    ADD CONSTRAINT fg_documento_anulacion_pkey PRIMARY KEY (id);


--
-- Name: fg_documento_electronico_operacion fg_documento_electronico_operacion_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_documento_electronico_operacion
    ADD CONSTRAINT fg_documento_electronico_operacion_pkey PRIMARY KEY (id);


--
-- Name: fg_ejecutivo fg_ejecutivo_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_ejecutivo
    ADD CONSTRAINT fg_ejecutivo_pkey PRIMARY KEY (id);


--
-- Name: fg_empresa_facturador fg_empresa_facturador_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_empresa_facturador
    ADD CONSTRAINT fg_empresa_facturador_pkey PRIMARY KEY (id);


--
-- Name: fg_empresa fg_empresa_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_empresa
    ADD CONSTRAINT fg_empresa_pkey PRIMARY KEY (key);


--
-- Name: fg_facturacion fg_facturacion_certificado_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_facturacion
    ADD CONSTRAINT fg_facturacion_certificado_id_key UNIQUE (certificado_id);


--
-- Name: fg_facturacion_cuota fg_facturacion_cuota_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_facturacion_cuota
    ADD CONSTRAINT fg_facturacion_cuota_pkey PRIMARY KEY (id);


--
-- Name: fg_facturacion_intento fg_facturacion_intento_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_facturacion_intento
    ADD CONSTRAINT fg_facturacion_intento_pkey PRIMARY KEY (id);


--
-- Name: fg_facturacion fg_facturacion_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_facturacion
    ADD CONSTRAINT fg_facturacion_pkey PRIMARY KEY (id);


--
-- Name: fg_inventario_cantidad_movimiento fg_inventario_cantidad_movimiento_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_inventario_cantidad_movimiento
    ADD CONSTRAINT fg_inventario_cantidad_movimiento_pkey PRIMARY KEY (id);


--
-- Name: fg_inventario_cantidad_movimiento fg_inventario_cantidad_movimiento_venta_uk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_inventario_cantidad_movimiento
    ADD CONSTRAINT fg_inventario_cantidad_movimiento_venta_uk UNIQUE (operacion_detalle_id);


--
-- Name: fg_operacion_comercial fg_operacion_comercial_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_operacion_comercial
    ADD CONSTRAINT fg_operacion_comercial_pkey PRIMARY KEY (id);


--
-- Name: fg_operacion_detalle_chip fg_operacion_detalle_chip_chip_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_operacion_detalle_chip
    ADD CONSTRAINT fg_operacion_detalle_chip_chip_id_key UNIQUE (chip_id);


--
-- Name: fg_operacion_detalle_chip fg_operacion_detalle_chip_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_operacion_detalle_chip
    ADD CONSTRAINT fg_operacion_detalle_chip_pkey PRIMARY KEY (operacion_detalle_id);


--
-- Name: fg_operacion_detalle fg_operacion_detalle_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_operacion_detalle
    ADD CONSTRAINT fg_operacion_detalle_pkey PRIMARY KEY (id);


--
-- Name: fg_orden_pago fg_orden_pago_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_orden_pago
    ADD CONSTRAINT fg_orden_pago_pkey PRIMARY KEY (id);


--
-- Name: fg_pago fg_pago_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_pago
    ADD CONSTRAINT fg_pago_pkey PRIMARY KEY (id);


--
-- Name: fg_perfil fg_perfil_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_perfil
    ADD CONSTRAINT fg_perfil_pkey PRIMARY KEY (clave);


--
-- Name: fg_perfil_planta fg_perfil_planta_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_perfil_planta
    ADD CONSTRAINT fg_perfil_planta_pkey PRIMARY KEY (perfil_clave, planta_key);


--
-- Name: fg_permiso fg_permiso_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_permiso
    ADD CONSTRAINT fg_permiso_pkey PRIMARY KEY (clave);


--
-- Name: fg_planta fg_planta_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_planta
    ADD CONSTRAINT fg_planta_pkey PRIMARY KEY (key);


--
-- Name: fg_producto_facturacion fg_producto_facturacion_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_producto_facturacion
    ADD CONSTRAINT fg_producto_facturacion_pkey PRIMARY KEY (id);


--
-- Name: fg_producto_inventariable fg_producto_inventariable_codigo_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_producto_inventariable
    ADD CONSTRAINT fg_producto_inventariable_codigo_key UNIQUE (codigo);


--
-- Name: fg_producto_inventariable fg_producto_inventariable_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_producto_inventariable
    ADD CONSTRAINT fg_producto_inventariable_pkey PRIMARY KEY (id);


--
-- Name: fg_producto_inventariable_sede fg_producto_inventariable_sede_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_producto_inventariable_sede
    ADD CONSTRAINT fg_producto_inventariable_sede_pkey PRIMARY KEY (id);


--
-- Name: fg_producto_sede fg_producto_sede_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_producto_sede
    ADD CONSTRAINT fg_producto_sede_pkey PRIMARY KEY (id);


--
-- Name: fg_serie_comprobante fg_serie_comprobante_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_serie_comprobante
    ADD CONSTRAINT fg_serie_comprobante_pkey PRIMARY KEY (id);


--
-- Name: fg_servicio fg_servicio_codigo_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_servicio
    ADD CONSTRAINT fg_servicio_codigo_key UNIQUE (codigo);


--
-- Name: fg_servicio fg_servicio_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_servicio
    ADD CONSTRAINT fg_servicio_pkey PRIMARY KEY (id);


--
-- Name: fg_taller_autorizado fg_taller_autorizado_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_taller_autorizado
    ADD CONSTRAINT fg_taller_autorizado_pkey PRIMARY KEY (id);


--
-- Name: fg_tarifa fg_tarifa_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_tarifa
    ADD CONSTRAINT fg_tarifa_pkey PRIMARY KEY (id);


--
-- Name: fg_tipo_certificado fg_tipo_certificado_codigo_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_tipo_certificado
    ADD CONSTRAINT fg_tipo_certificado_codigo_key UNIQUE (codigo);


--
-- Name: fg_tipo_certificado fg_tipo_certificado_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_tipo_certificado
    ADD CONSTRAINT fg_tipo_certificado_pkey PRIMARY KEY (clave);


--
-- Name: fg_usuario fg_usuario_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_usuario
    ADD CONSTRAINT fg_usuario_pkey PRIMARY KEY (username);


--
-- Name: fg_usuario_sesion fg_usuario_sesion_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_usuario_sesion
    ADD CONSTRAINT fg_usuario_sesion_pkey PRIMARY KEY (id);


--
-- Name: fg_usuario_sesion fg_usuario_sesion_session_jti_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_usuario_sesion
    ADD CONSTRAINT fg_usuario_sesion_session_jti_key UNIQUE (session_jti);


--
-- Name: fg_vehiculo fg_vehiculo_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_vehiculo
    ADD CONSTRAINT fg_vehiculo_pkey PRIMARY KEY (id);


--
-- Name: fg_venta_detalle fg_venta_detalle_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_venta_detalle
    ADD CONSTRAINT fg_venta_detalle_pkey PRIMARY KEY (id);


--
-- Name: fg_venta fg_venta_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_venta
    ADD CONSTRAINT fg_venta_pkey PRIMARY KEY (id);


--
-- Name: fg_perfil_permiso pk_fg_perfil_permiso; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_perfil_permiso
    ADD CONSTRAINT pk_fg_perfil_permiso PRIMARY KEY (perfil_clave, permiso_clave);


--
-- Name: fg_usuario_planta pk_fg_usuario_planta; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_usuario_planta
    ADD CONSTRAINT pk_fg_usuario_planta PRIMARY KEY (usuario_username, plantas_key);


--
-- Name: fg_categoria_servicio uk_fg_categoria_servicio_codigo; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_categoria_servicio
    ADD CONSTRAINT uk_fg_categoria_servicio_codigo UNIQUE (codigo);


--
-- Name: fg_producto_facturacion uk_fg_producto_facturacion_sku; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_producto_facturacion
    ADD CONSTRAINT uk_fg_producto_facturacion_sku UNIQUE (codigo_sku);


--
-- Name: fg_serie_comprobante uk_fg_serie_comprobante_sede_tipo_serie; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_serie_comprobante
    ADD CONSTRAINT uk_fg_serie_comprobante_sede_tipo_serie UNIQUE (planta_key, tipo_comprobante, serie);


--
-- Name: fg_tarifa uk_fg_tarifa_planta_codigo; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_tarifa
    ADD CONSTRAINT uk_fg_tarifa_planta_codigo UNIQUE (planta_key, codigo);


--
-- Name: fg_documento_anulacion uq_fg_anulacion_codigo; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_documento_anulacion
    ADD CONSTRAINT uq_fg_anulacion_codigo UNIQUE (codigo_unico);


--
-- Name: fg_certificado_chip uq_fg_certificado_chip_chip; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_certificado_chip
    ADD CONSTRAINT uq_fg_certificado_chip_chip UNIQUE (chip_id);


--
-- Name: fg_empresa_facturador uq_fg_empresa_facturador; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_empresa_facturador
    ADD CONSTRAINT uq_fg_empresa_facturador UNIQUE (empresa_key, proveedor, entorno);


--
-- Name: fg_empresa_facturador uq_fg_empresa_facturador_credencial; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_empresa_facturador
    ADD CONSTRAINT uq_fg_empresa_facturador_credencial UNIQUE (proveedor, entorno, credencial_clave);


--
-- Name: fg_facturacion_cuota uq_fg_facturacion_cuota_numero; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_facturacion_cuota
    ADD CONSTRAINT uq_fg_facturacion_cuota_numero UNIQUE (facturacion_id, numero_cuota);


--
-- Name: fg_facturacion uq_fg_facturacion_emisor_serie_numero; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_facturacion
    ADD CONSTRAINT uq_fg_facturacion_emisor_serie_numero UNIQUE (ruc_emisor, entorno_facturador, tipo_comprobante, serie, numero);


--
-- Name: fg_facturacion_intento uq_fg_facturacion_intento_numero; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_facturacion_intento
    ADD CONSTRAINT uq_fg_facturacion_intento_numero UNIQUE (facturacion_id, numero_intento);


--
-- Name: fg_operacion_detalle uq_fg_operacion_detalle_orden; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_operacion_detalle
    ADD CONSTRAINT uq_fg_operacion_detalle_orden UNIQUE (operacion_id, orden);


--
-- Name: fg_orden_pago uq_fg_orden_pago_certificado; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_orden_pago
    ADD CONSTRAINT uq_fg_orden_pago_certificado UNIQUE (certificado_id);


--
-- Name: fg_producto_inventariable_sede uq_fg_producto_inventariable_sede; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_producto_inventariable_sede
    ADD CONSTRAINT uq_fg_producto_inventariable_sede UNIQUE (producto_inventariable_id, planta_key);


--
-- Name: fg_producto_sede uq_fg_producto_sede; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_producto_sede
    ADD CONSTRAINT uq_fg_producto_sede UNIQUE (planta_key, producto_facturacion_id);


--
-- Name: fg_vehiculo uq_fg_vehiculo_placa_normalizada; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_vehiculo
    ADD CONSTRAINT uq_fg_vehiculo_placa_normalizada UNIQUE (placa_normalizada);


--
-- Name: fg_correlativo_certificado_activo_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX fg_correlativo_certificado_activo_idx ON public.fg_correlativo_certificado USING btree (planta_key, tipo_certificado_clave, modalidad) WHERE (activo = true);


--
-- Name: fg_inventario_cantidad_movimiento_operacion_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX fg_inventario_cantidad_movimiento_operacion_idx ON public.fg_inventario_cantidad_movimiento USING btree (operacion_detalle_id) WHERE (operacion_detalle_id IS NOT NULL);


--
-- Name: fg_inventario_cantidad_movimiento_stock_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX fg_inventario_cantidad_movimiento_stock_idx ON public.fg_inventario_cantidad_movimiento USING btree (producto_inventariable_id, planta_key, fecha_creacion, id);


--
-- Name: idx_fg_auditoria_acceso_evento; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fg_auditoria_acceso_evento ON public.fg_auditoria_acceso USING btree (evento);


--
-- Name: idx_fg_auditoria_acceso_fecha_evento; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fg_auditoria_acceso_fecha_evento ON public.fg_auditoria_acceso USING btree (fecha_evento);


--
-- Name: idx_fg_auditoria_acceso_username; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fg_auditoria_acceso_username ON public.fg_auditoria_acceso USING btree (username);


--
-- Name: idx_fg_cert_titular_cli; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fg_cert_titular_cli ON public.fg_certificado_titular USING btree (cliente_id);


--
-- Name: idx_fg_certificado_cli; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fg_certificado_cli ON public.fg_certificado USING btree (cliente_id);


--
-- Name: idx_fg_certificado_estado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fg_certificado_estado ON public.fg_certificado USING btree (estado);


--
-- Name: idx_fg_certificado_fecha; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fg_certificado_fecha ON public.fg_certificado USING btree (fecha_emision);


--
-- Name: idx_fg_certificado_planta; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fg_certificado_planta ON public.fg_certificado USING btree (planta_key);


--
-- Name: idx_fg_certificado_tipo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fg_certificado_tipo ON public.fg_certificado USING btree (tipo_certificado_clave);


--
-- Name: idx_fg_corr_sede_consumo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fg_corr_sede_consumo ON public.fg_correlativo_certificado_sede USING btree (planta_key) WHERE ((estado)::text = 'ACTIVO'::text);


--
-- Name: idx_fg_corr_sede_estado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fg_corr_sede_estado ON public.fg_correlativo_certificado_sede USING btree (estado, fecha_asignacion);


--
-- Name: idx_fg_corr_sede_planta; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fg_corr_sede_planta ON public.fg_correlativo_certificado_sede USING btree (planta_key, rango_inicio);


--
-- Name: idx_fg_correlativo_certificado_listado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fg_correlativo_certificado_listado ON public.fg_correlativo_certificado USING btree (planta_key, tipo_certificado_clave, modalidad, activo);


--
-- Name: idx_fg_descom_cert; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fg_descom_cert ON public.fg_descuentocomprobante USING btree (certificado_id);


--
-- Name: idx_fg_descom_descli; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fg_descom_descli ON public.fg_descuentocomprobante USING btree (descuento_cliente_id);


--
-- Name: idx_fg_descom_estado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fg_descom_estado ON public.fg_descuentocomprobante USING btree (estado);


--
-- Name: idx_fg_descuentocliente_doc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fg_descuentocliente_doc ON public.fg_descuentocliente USING btree (nro_documento);


--
-- Name: idx_fg_descuentocliente_placa; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fg_descuentocliente_placa ON public.fg_descuentocliente USING btree (placa);


--
-- Name: idx_fg_descuentocliente_planta; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fg_descuentocliente_planta ON public.fg_descuentocliente USING btree (planta_key);


--
-- Name: idx_fg_descuentodetalle_codigo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fg_descuentodetalle_codigo ON public.fg_descuentodetalle USING btree (descuento_cliente_id);


--
-- Name: idx_fg_descuentodetalle_planta_servicio; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fg_descuentodetalle_planta_servicio ON public.fg_descuentodetalle USING btree (planta_key, servicio_id);


--
-- Name: idx_fg_empresa_facturador_activo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fg_empresa_facturador_activo ON public.fg_empresa_facturador USING btree (empresa_key, proveedor, entorno, activo);


--
-- Name: idx_fg_empresa_listado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fg_empresa_listado ON public.fg_empresa USING btree (activo DESC, nombre);


--
-- Name: idx_fg_facturacion_emisor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fg_facturacion_emisor ON public.fg_facturacion USING btree (empresa_key, entorno_facturador, fecha_creacion DESC);


--
-- Name: idx_fg_facturacion_estado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fg_facturacion_estado ON public.fg_facturacion USING btree (estado);


--
-- Name: idx_fg_facturacion_intento_facturacion; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fg_facturacion_intento_facturacion ON public.fg_facturacion_intento USING btree (facturacion_id, numero_intento DESC);


--
-- Name: idx_fg_pago_fecha; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fg_pago_fecha ON public.fg_pago USING btree (fechacreacion);


--
-- Name: idx_fg_pago_orden; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fg_pago_orden ON public.fg_pago USING btree (orden_pago_id);


--
-- Name: idx_fg_pago_tipo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fg_pago_tipo ON public.fg_pago USING btree (tipocontado_key);


--
-- Name: idx_fg_perfil_permiso_perfil; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fg_perfil_permiso_perfil ON public.fg_perfil_permiso USING btree (perfil_clave);


--
-- Name: idx_fg_perfil_permiso_permiso; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fg_perfil_permiso_permiso ON public.fg_perfil_permiso USING btree (permiso_clave);


--
-- Name: idx_fg_planta_empresa; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fg_planta_empresa ON public.fg_planta USING btree (empresa_key, activo, nombre);


--
-- Name: idx_fg_producto_facturacion_categoria; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fg_producto_facturacion_categoria ON public.fg_producto_facturacion USING btree (categoria_id, activo);


--
-- Name: idx_fg_producto_facturacion_descripcion; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fg_producto_facturacion_descripcion ON public.fg_producto_facturacion USING btree (descripcion);


--
-- Name: idx_fg_producto_facturacion_filtros; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fg_producto_facturacion_filtros ON public.fg_producto_facturacion USING btree (activo, es_para_venta, unidad);


--
-- Name: idx_fg_serie_comprobante_listado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fg_serie_comprobante_listado ON public.fg_serie_comprobante USING btree (planta_key, tipo_comprobante, activo);


--
-- Name: idx_fg_servicio_categoria; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fg_servicio_categoria ON public.fg_servicio USING btree (categoria_id);


--
-- Name: idx_fg_tarifa_producto_facturacion; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fg_tarifa_producto_facturacion ON public.fg_tarifa USING btree (producto_facturacion_id);


--
-- Name: idx_fg_tarifa_servicio; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fg_tarifa_servicio ON public.fg_tarifa USING btree (servicio_id);


--
-- Name: idx_fg_usuario_persona_nrodocumento; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fg_usuario_persona_nrodocumento ON public.fg_usuario USING btree (persona_nrodocumentoidentidad) WHERE (persona_nrodocumentoidentidad IS NOT NULL);


--
-- Name: idx_fg_usuario_sesion_user_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fg_usuario_sesion_user_active ON public.fg_usuario_sesion USING btree (usuario_username, isactive);


--
-- Name: idx_fg_vehiculo_numero_motor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fg_vehiculo_numero_motor ON public.fg_vehiculo USING btree (upper((numero_motor)::text)) WHERE (numero_motor IS NOT NULL);


--
-- Name: idx_fg_vehiculo_vin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fg_vehiculo_vin ON public.fg_vehiculo USING btree (upper((vin)::text)) WHERE (vin IS NOT NULL);


--
-- Name: ix_fg_auditoria_categoria_fecha; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_fg_auditoria_categoria_fecha ON public.fg_auditoria_acceso USING btree (categoria, fecha_evento DESC);


--
-- Name: ix_fg_auditoria_certificado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_fg_auditoria_certificado ON public.fg_auditoria_acceso USING btree (certificado_id, fecha_evento DESC) WHERE (certificado_id IS NOT NULL);


--
-- Name: ix_fg_auditoria_placa; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_fg_auditoria_placa ON public.fg_auditoria_acceso USING btree (placa, fecha_evento DESC) WHERE (placa IS NOT NULL);


--
-- Name: ix_fg_certificado_borradores_panel; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_fg_certificado_borradores_panel ON public.fg_certificado USING btree (planta_key, estado, fecha_modificacion DESC, id DESC);


--
-- Name: ix_fg_certificado_panel_fecha_creacion; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_fg_certificado_panel_fecha_creacion ON public.fg_certificado USING btree (planta_key, estado, fecha_creacion DESC, id DESC);


--
-- Name: ix_fg_chip_movimiento_chip; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_fg_chip_movimiento_chip ON public.fg_chip_movimiento USING btree (chip_id, fecha DESC, id DESC);


--
-- Name: ix_fg_chip_stock; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_fg_chip_stock ON public.fg_chip USING btree (planta_actual_key, estado, producto_inventariable_id);


--
-- Name: ix_fg_credito_facturacion; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_fg_credito_facturacion ON public.fg_credito USING btree (facturacion_id, fecha_creacion DESC);


--
-- Name: ix_fg_debito_facturacion; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_fg_debito_facturacion ON public.fg_debito USING btree (facturacion_id, fecha_creacion DESC);


--
-- Name: ix_fg_descuento_ejecutivo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_fg_descuento_ejecutivo ON public.fg_descuento USING btree (ejecutivo_id) WHERE (ejecutivo_id IS NOT NULL);


--
-- Name: ix_fg_doc_operacion_anulacion; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_fg_doc_operacion_anulacion ON public.fg_documento_electronico_operacion USING btree (anulacion_id, fecha_creacion DESC);


--
-- Name: ix_fg_doc_operacion_credito; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_fg_doc_operacion_credito ON public.fg_documento_electronico_operacion USING btree (credito_id, fecha_creacion DESC);


--
-- Name: ix_fg_doc_operacion_debito; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_fg_doc_operacion_debito ON public.fg_documento_electronico_operacion USING btree (debito_id, fecha_creacion DESC);


--
-- Name: ix_fg_doc_operacion_facturacion; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_fg_doc_operacion_facturacion ON public.fg_documento_electronico_operacion USING btree (facturacion_id, fecha_creacion DESC);


--
-- Name: ix_fg_facturacion_cuota_vencimiento; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_fg_facturacion_cuota_vencimiento ON public.fg_facturacion_cuota USING btree (facturacion_id, fecha_pago, numero_cuota);


--
-- Name: ix_fg_facturacion_pendiente_monitoreo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_fg_facturacion_pendiente_monitoreo ON public.fg_facturacion USING btree (estado, fecha_ultimo_intento) WHERE ((estado)::text = ANY ((ARRAY['PENDIENTE'::character varying, 'ERROR'::character varying, 'RECHAZADO'::character varying])::text[]));


--
-- Name: ix_fg_operacion_detalle_operacion; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_fg_operacion_detalle_operacion ON public.fg_operacion_detalle USING btree (operacion_id, orden);


--
-- Name: ix_fg_operacion_panel; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_fg_operacion_panel ON public.fg_operacion_comercial USING btree (planta_key, estado, fecha_creacion DESC, id DESC);


--
-- Name: ix_fg_producto_inventariable_sede_producto_fiscal; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_fg_producto_inventariable_sede_producto_fiscal ON public.fg_producto_inventariable_sede USING btree (producto_facturacion_id);


--
-- Name: ix_fg_producto_sede_catalogo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_fg_producto_sede_catalogo ON public.fg_producto_sede USING btree (planta_key, activo, orden, producto_facturacion_id);


--
-- Name: ix_fg_usuario_sesion_planta_key; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_fg_usuario_sesion_planta_key ON public.fg_usuario_sesion USING btree (planta_key) WHERE (planta_key IS NOT NULL);


--
-- Name: uk_fg_corr_sede_activo; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uk_fg_corr_sede_activo ON public.fg_correlativo_certificado_sede USING btree (planta_key) WHERE ((estado)::text = 'ACTIVO'::text);


--
-- Name: uk_fg_serie_comprobante_predeterminada_activa; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uk_fg_serie_comprobante_predeterminada_activa ON public.fg_serie_comprobante USING btree (planta_key, tipo_comprobante, proveedor_emision, entorno_emision) WHERE ((activo = true) AND (es_predeterminada = true));


--
-- Name: uk_fg_tarifa_planta_servicio; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uk_fg_tarifa_planta_servicio ON public.fg_tarifa USING btree (planta_key, servicio_id);


--
-- Name: uq_fg_anulacion_credito_activa; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_fg_anulacion_credito_activa ON public.fg_documento_anulacion USING btree (credito_id) WHERE ((credito_id IS NOT NULL) AND ((estado)::text = ANY ((ARRAY['BORRADOR'::character varying, 'PENDIENTE'::character varying, 'ACEPTADO'::character varying])::text[])));


--
-- Name: uq_fg_anulacion_debito_activa; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_fg_anulacion_debito_activa ON public.fg_documento_anulacion USING btree (debito_id) WHERE ((debito_id IS NOT NULL) AND ((estado)::text = ANY ((ARRAY['BORRADOR'::character varying, 'PENDIENTE'::character varying, 'ACEPTADO'::character varying])::text[])));


--
-- Name: uq_fg_anulacion_facturacion_activa; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_fg_anulacion_facturacion_activa ON public.fg_documento_anulacion USING btree (facturacion_id) WHERE ((facturacion_id IS NOT NULL) AND ((estado)::text = ANY ((ARRAY['BORRADOR'::character varying, 'PENDIENTE'::character varying, 'ACEPTADO'::character varying])::text[])));


--
-- Name: uq_fg_credito_proveedor_codigo_unico; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_fg_credito_proveedor_codigo_unico ON public.fg_credito USING btree (proveedor, codigo_unico) WHERE (codigo_unico IS NOT NULL);


--
-- Name: uq_fg_credito_serie_numero; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_fg_credito_serie_numero ON public.fg_credito USING btree (planta_key, serie, numero) WHERE ((serie IS NOT NULL) AND (numero IS NOT NULL));


--
-- Name: uq_fg_debito_proveedor_codigo_unico; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_fg_debito_proveedor_codigo_unico ON public.fg_debito USING btree (proveedor, codigo_unico) WHERE (codigo_unico IS NOT NULL);


--
-- Name: uq_fg_debito_serie_numero; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_fg_debito_serie_numero ON public.fg_debito USING btree (planta_key, serie, numero) WHERE ((serie IS NOT NULL) AND (numero IS NOT NULL));


--
-- Name: uq_fg_descom_certificado_activo; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_fg_descom_certificado_activo ON public.fg_descuentocomprobante USING btree (certificado_id) WHERE ((estado)::text = ANY ((ARRAY['RESERVADO'::character varying, 'APLICADO'::character varying])::text[]));


--
-- Name: uq_fg_descuento_codigo_upper; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_fg_descuento_codigo_upper ON public.fg_descuento USING btree (upper(btrim((codigo)::text)));


--
-- Name: uq_fg_descuentocliente_codigo_upper; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_fg_descuentocliente_codigo_upper ON public.fg_descuentocliente USING btree (upper(btrim((codigo)::text)));


--
-- Name: uq_fg_descuentodetalle_descuento_sede_servicio; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_fg_descuentodetalle_descuento_sede_servicio ON public.fg_descuentodetalle USING btree (descuento_id, planta_key, servicio_id) WHERE (descuento_cliente_id IS NULL);


--
-- Name: uq_fg_ejecutivo_nombre; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_fg_ejecutivo_nombre ON public.fg_ejecutivo USING btree (lower(btrim((nombre)::text)));


--
-- Name: uq_fg_empresa_ruc; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_fg_empresa_ruc ON public.fg_empresa USING btree (ruc) WHERE (ruc IS NOT NULL);


--
-- Name: uq_fg_facturacion_operacion; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_fg_facturacion_operacion ON public.fg_facturacion USING btree (operacion_id) WHERE (operacion_id IS NOT NULL);


--
-- Name: uq_fg_facturacion_proveedor_codigo_unico; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_fg_facturacion_proveedor_codigo_unico ON public.fg_facturacion USING btree (proveedor, codigo_unico) WHERE (codigo_unico IS NOT NULL);


--
-- Name: uq_fg_operacion_detalle_certificado; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_fg_operacion_detalle_certificado ON public.fg_operacion_detalle USING btree (certificado_id) WHERE (certificado_id IS NOT NULL);


--
-- Name: uq_fg_orden_pago_operacion; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_fg_orden_pago_operacion ON public.fg_orden_pago USING btree (operacion_id) WHERE (operacion_id IS NOT NULL);


--
-- Name: uq_fg_serie_nubefact_demo_emisor_tipo; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_fg_serie_nubefact_demo_emisor_tipo ON public.fg_serie_comprobante USING btree (empresa_key, tipo_comprobante, entorno_emision) WHERE (((proveedor_emision)::text = 'NUBEFACT'::text) AND ((entorno_emision)::text = 'DEMO'::text) AND (activo = true) AND (es_predeterminada = true));


--
-- Name: uq_fg_serie_nubefact_empresa_documento; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_fg_serie_nubefact_empresa_documento ON public.fg_serie_comprobante USING btree (empresa_key, tipo_comprobante, serie) WHERE ((proveedor_emision)::text = 'NUBEFACT'::text);


--
-- Name: uq_fg_taller_autorizado_planta; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_fg_taller_autorizado_planta ON public.fg_taller_autorizado USING btree (planta_key) WHERE (planta_key IS NOT NULL);


--
-- Name: fg_inventario_cantidad_movimiento fg_inventario_cantidad_movimiento_inmutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER fg_inventario_cantidad_movimiento_inmutable BEFORE DELETE OR UPDATE ON public.fg_inventario_cantidad_movimiento FOR EACH ROW EXECUTE FUNCTION public.fg_bloquear_mutacion_movimiento_inventario_cantidad();


--
-- Name: fg_certificado_chip fg_certificado_chip_certificado_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_certificado_chip
    ADD CONSTRAINT fg_certificado_chip_certificado_id_fkey FOREIGN KEY (certificado_id) REFERENCES public.fg_certificado(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_certificado_chip fg_certificado_chip_chip_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_certificado_chip
    ADD CONSTRAINT fg_certificado_chip_chip_id_fkey FOREIGN KEY (chip_id) REFERENCES public.fg_chip(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_certificado_formato fg_certificado_formato_formato_padre_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_certificado_formato
    ADD CONSTRAINT fg_certificado_formato_formato_padre_id_fkey FOREIGN KEY (formato_padre_id) REFERENCES public.fg_certificado_formato(id);


--
-- Name: fg_certificado_formato_version fg_certificado_formato_version_formato_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_certificado_formato_version
    ADD CONSTRAINT fg_certificado_formato_version_formato_id_fkey FOREIGN KEY (formato_id) REFERENCES public.fg_certificado_formato(id) ON DELETE CASCADE;


--
-- Name: fg_certificado fg_certificado_formato_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_certificado
    ADD CONSTRAINT fg_certificado_formato_version_id_fkey FOREIGN KEY (formato_version_id) REFERENCES public.fg_certificado_formato_version(id);


--
-- Name: fg_certificado_gnv_componente fg_certificado_gnv_componente_certificado_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_certificado_gnv_componente
    ADD CONSTRAINT fg_certificado_gnv_componente_certificado_id_fkey FOREIGN KEY (certificado_id) REFERENCES public.fg_certificado_gnv(certificado_id) ON DELETE CASCADE;


--
-- Name: fg_certificado fg_certificado_producto_chip_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_certificado
    ADD CONSTRAINT fg_certificado_producto_chip_id_fkey FOREIGN KEY (producto_chip_id) REFERENCES public.fg_producto_inventariable(id) ON DELETE RESTRICT;


--
-- Name: fg_certificado fg_certificado_producto_facturacion_certificado_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_certificado
    ADD CONSTRAINT fg_certificado_producto_facturacion_certificado_id_fkey FOREIGN KEY (producto_facturacion_certificado_id) REFERENCES public.fg_producto_facturacion(id) ON DELETE RESTRICT;


--
-- Name: fg_certificado fg_certificado_producto_facturacion_chip_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_certificado
    ADD CONSTRAINT fg_certificado_producto_facturacion_chip_id_fkey FOREIGN KEY (producto_facturacion_chip_id) REFERENCES public.fg_producto_facturacion(id) ON DELETE RESTRICT;


--
-- Name: fg_chip fg_chip_actualizado_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_chip
    ADD CONSTRAINT fg_chip_actualizado_por_fkey FOREIGN KEY (actualizado_por) REFERENCES public.fg_usuario(username) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_chip fg_chip_creado_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_chip
    ADD CONSTRAINT fg_chip_creado_por_fkey FOREIGN KEY (creado_por) REFERENCES public.fg_usuario(username) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_chip_movimiento fg_chip_movimiento_certificado_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_chip_movimiento
    ADD CONSTRAINT fg_chip_movimiento_certificado_id_fkey FOREIGN KEY (certificado_id) REFERENCES public.fg_certificado(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_chip_movimiento fg_chip_movimiento_chip_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_chip_movimiento
    ADD CONSTRAINT fg_chip_movimiento_chip_id_fkey FOREIGN KEY (chip_id) REFERENCES public.fg_chip(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_chip_movimiento fg_chip_movimiento_operacion_comercial_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_chip_movimiento
    ADD CONSTRAINT fg_chip_movimiento_operacion_comercial_id_fkey FOREIGN KEY (operacion_comercial_id) REFERENCES public.fg_operacion_comercial(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_chip_movimiento fg_chip_movimiento_planta_destino_key_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_chip_movimiento
    ADD CONSTRAINT fg_chip_movimiento_planta_destino_key_fkey FOREIGN KEY (planta_destino_key) REFERENCES public.fg_planta(key) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_chip_movimiento fg_chip_movimiento_planta_origen_key_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_chip_movimiento
    ADD CONSTRAINT fg_chip_movimiento_planta_origen_key_fkey FOREIGN KEY (planta_origen_key) REFERENCES public.fg_planta(key) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_chip_movimiento fg_chip_movimiento_usuario_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_chip_movimiento
    ADD CONSTRAINT fg_chip_movimiento_usuario_fkey FOREIGN KEY (usuario) REFERENCES public.fg_usuario(username) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_chip fg_chip_operacion_reserva_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_chip
    ADD CONSTRAINT fg_chip_operacion_reserva_id_fkey FOREIGN KEY (operacion_reserva_id) REFERENCES public.fg_operacion_comercial(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_chip fg_chip_planta_actual_key_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_chip
    ADD CONSTRAINT fg_chip_planta_actual_key_fkey FOREIGN KEY (planta_actual_key) REFERENCES public.fg_planta(key) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_chip fg_chip_producto_inventariable_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_chip
    ADD CONSTRAINT fg_chip_producto_inventariable_id_fkey FOREIGN KEY (producto_inventariable_id) REFERENCES public.fg_producto_inventariable(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_correlativo_certificado_sede fg_correlativo_certificado_sede_planta_key_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_correlativo_certificado_sede
    ADD CONSTRAINT fg_correlativo_certificado_sede_planta_key_fkey FOREIGN KEY (planta_key) REFERENCES public.fg_planta(key);


--
-- Name: fg_facturacion fg_facturacion_venta_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_facturacion
    ADD CONSTRAINT fg_facturacion_venta_id_fkey FOREIGN KEY (venta_id) REFERENCES public.fg_venta(id);


--
-- Name: fg_inventario_cantidad_movimiento fg_inventario_cantidad_movimient_producto_inventariable_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_inventario_cantidad_movimiento
    ADD CONSTRAINT fg_inventario_cantidad_movimient_producto_inventariable_id_fkey FOREIGN KEY (producto_inventariable_id) REFERENCES public.fg_producto_inventariable(id) ON DELETE RESTRICT;


--
-- Name: fg_inventario_cantidad_movimiento fg_inventario_cantidad_movimiento_operacion_detalle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_inventario_cantidad_movimiento
    ADD CONSTRAINT fg_inventario_cantidad_movimiento_operacion_detalle_id_fkey FOREIGN KEY (operacion_detalle_id) REFERENCES public.fg_operacion_detalle(id) ON DELETE RESTRICT;


--
-- Name: fg_inventario_cantidad_movimiento fg_inventario_cantidad_movimiento_planta_key_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_inventario_cantidad_movimiento
    ADD CONSTRAINT fg_inventario_cantidad_movimiento_planta_key_fkey FOREIGN KEY (planta_key) REFERENCES public.fg_planta(key) ON DELETE RESTRICT;


--
-- Name: fg_inventario_cantidad_movimiento fg_inventario_cantidad_movimiento_usuario_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_inventario_cantidad_movimiento
    ADD CONSTRAINT fg_inventario_cantidad_movimiento_usuario_fkey FOREIGN KEY (usuario) REFERENCES public.fg_usuario(username) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_operacion_detalle_chip fg_operacion_detalle_chip_chip_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_operacion_detalle_chip
    ADD CONSTRAINT fg_operacion_detalle_chip_chip_id_fkey FOREIGN KEY (chip_id) REFERENCES public.fg_chip(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_operacion_detalle_chip fg_operacion_detalle_chip_operacion_detalle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_operacion_detalle_chip
    ADD CONSTRAINT fg_operacion_detalle_chip_operacion_detalle_id_fkey FOREIGN KEY (operacion_detalle_id) REFERENCES public.fg_operacion_detalle(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: fg_orden_pago fg_orden_pago_venta_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_orden_pago
    ADD CONSTRAINT fg_orden_pago_venta_id_fkey FOREIGN KEY (venta_id) REFERENCES public.fg_venta(id);


--
-- Name: fg_perfil_planta fg_perfil_planta_perfil_clave_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_perfil_planta
    ADD CONSTRAINT fg_perfil_planta_perfil_clave_fkey FOREIGN KEY (perfil_clave) REFERENCES public.fg_perfil(clave);


--
-- Name: fg_perfil_planta fg_perfil_planta_planta_key_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_perfil_planta
    ADD CONSTRAINT fg_perfil_planta_planta_key_fkey FOREIGN KEY (planta_key) REFERENCES public.fg_planta(key);


--
-- Name: fg_producto_inventariable fg_producto_inventariable_producto_facturacion_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_producto_inventariable
    ADD CONSTRAINT fg_producto_inventariable_producto_facturacion_id_fkey FOREIGN KEY (producto_facturacion_id) REFERENCES public.fg_producto_facturacion(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_producto_inventariable_sede fg_producto_inventariable_sede_planta_key_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_producto_inventariable_sede
    ADD CONSTRAINT fg_producto_inventariable_sede_planta_key_fkey FOREIGN KEY (planta_key) REFERENCES public.fg_planta(key) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_producto_inventariable_sede fg_producto_inventariable_sede_producto_inventariable_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_producto_inventariable_sede
    ADD CONSTRAINT fg_producto_inventariable_sede_producto_inventariable_id_fkey FOREIGN KEY (producto_inventariable_id) REFERENCES public.fg_producto_inventariable(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_servicio fg_servicio_formato_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_servicio
    ADD CONSTRAINT fg_servicio_formato_id_fkey FOREIGN KEY (formato_id) REFERENCES public.fg_certificado_formato(id);


--
-- Name: fg_servicio fg_servicio_tipo_certificado_clave_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_servicio
    ADD CONSTRAINT fg_servicio_tipo_certificado_clave_fkey FOREIGN KEY (tipo_certificado_clave) REFERENCES public.fg_tipo_certificado(clave);


--
-- Name: fg_venta_detalle fg_venta_detalle_chip_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_venta_detalle
    ADD CONSTRAINT fg_venta_detalle_chip_id_fkey FOREIGN KEY (chip_id) REFERENCES public.fg_chip(id);


--
-- Name: fg_venta_detalle fg_venta_detalle_producto_inventariable_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_venta_detalle
    ADD CONSTRAINT fg_venta_detalle_producto_inventariable_id_fkey FOREIGN KEY (producto_inventariable_id) REFERENCES public.fg_producto_inventariable(id);


--
-- Name: fg_venta_detalle fg_venta_detalle_venta_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_venta_detalle
    ADD CONSTRAINT fg_venta_detalle_venta_id_fkey FOREIGN KEY (venta_id) REFERENCES public.fg_venta(id) ON DELETE CASCADE;


--
-- Name: fg_auditoria_config fk_auditoria_usuario; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_auditoria_config
    ADD CONSTRAINT fk_auditoria_usuario FOREIGN KEY (username) REFERENCES public.fg_usuario(username);


--
-- Name: fg_certificado_conformidad fk_cert_conf_cert; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_certificado_conformidad
    ADD CONSTRAINT fk_cert_conf_cert FOREIGN KEY (certificado_id) REFERENCES public.fg_certificado(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: fg_certificado_glp fk_cert_glp_cert; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_certificado_glp
    ADD CONSTRAINT fk_cert_glp_cert FOREIGN KEY (certificado_id) REFERENCES public.fg_certificado(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: fg_certificado_glp_componente fk_cert_glp_comp_cert; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_certificado_glp_componente
    ADD CONSTRAINT fk_cert_glp_comp_cert FOREIGN KEY (certificado_id) REFERENCES public.fg_certificado_glp(certificado_id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: fg_certificado_glp fk_cert_glp_taller; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_certificado_glp
    ADD CONSTRAINT fk_cert_glp_taller FOREIGN KEY (taller_autorizado_id) REFERENCES public.fg_taller_autorizado(id) ON UPDATE CASCADE;


--
-- Name: fg_certificado_glp_verificacion fk_cert_glp_verif_cert; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_certificado_glp_verificacion
    ADD CONSTRAINT fk_cert_glp_verif_cert FOREIGN KEY (certificado_id) REFERENCES public.fg_certificado_glp(certificado_id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: fg_certificado_gnv fk_cert_gnv_cert; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_certificado_gnv
    ADD CONSTRAINT fk_cert_gnv_cert FOREIGN KEY (certificado_id) REFERENCES public.fg_certificado(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: fg_certificado_gnv fk_cert_gnv_taller; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_certificado_gnv
    ADD CONSTRAINT fk_cert_gnv_taller FOREIGN KEY (taller_autorizado_id) REFERENCES public.fg_taller_autorizado(id) ON UPDATE CASCADE;


--
-- Name: fg_certificado_gnv_verificacion fk_cert_gnv_verif_cert; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_certificado_gnv_verificacion
    ADD CONSTRAINT fk_cert_gnv_verif_cert FOREIGN KEY (certificado_id) REFERENCES public.fg_certificado_gnv(certificado_id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: fg_certificado_titular fk_cert_titular_cert; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_certificado_titular
    ADD CONSTRAINT fk_cert_titular_cert FOREIGN KEY (certificado_id) REFERENCES public.fg_certificado(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: fg_certificado_titular fk_cert_titular_cliente; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_certificado_titular
    ADD CONSTRAINT fk_cert_titular_cliente FOREIGN KEY (cliente_id) REFERENCES public.fg_cliente(id) ON UPDATE CASCADE;


--
-- Name: fg_certificado_vehiculo fk_cert_vehiculo_cert; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_certificado_vehiculo
    ADD CONSTRAINT fk_cert_vehiculo_cert FOREIGN KEY (certificado_id) REFERENCES public.fg_certificado(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: fg_certificado fk_certificado_cliente; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_certificado
    ADD CONSTRAINT fk_certificado_cliente FOREIGN KEY (cliente_id) REFERENCES public.fg_cliente(id) ON UPDATE CASCADE;


--
-- Name: fg_certificado fk_certificado_planta; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_certificado
    ADD CONSTRAINT fk_certificado_planta FOREIGN KEY (planta_key) REFERENCES public.fg_planta(key) ON UPDATE CASCADE;


--
-- Name: fg_certificado fk_certificado_tipo; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_certificado
    ADD CONSTRAINT fk_certificado_tipo FOREIGN KEY (tipo_certificado_clave) REFERENCES public.fg_tipo_certificado(clave) ON UPDATE CASCADE;


--
-- Name: fg_certificado fk_certificado_usuarioc; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_certificado
    ADD CONSTRAINT fk_certificado_usuarioc FOREIGN KEY (usuario_creacion) REFERENCES public.fg_usuario(username) ON UPDATE CASCADE;


--
-- Name: fg_certificado fk_certificado_usuariom; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_certificado
    ADD CONSTRAINT fk_certificado_usuariom FOREIGN KEY (usuario_modificacion) REFERENCES public.fg_usuario(username) ON UPDATE CASCADE;


--
-- Name: fg_correlativo_certificado fk_correlativo_planta; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_correlativo_certificado
    ADD CONSTRAINT fk_correlativo_planta FOREIGN KEY (planta_key) REFERENCES public.fg_planta(key) ON UPDATE CASCADE;


--
-- Name: fg_correlativo_certificado fk_correlativo_tipo; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_correlativo_certificado
    ADD CONSTRAINT fk_correlativo_tipo FOREIGN KEY (tipo_certificado_clave) REFERENCES public.fg_tipo_certificado(clave) ON UPDATE CASCADE;


--
-- Name: fg_documento_anulacion fk_fg_anulacion_credito; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_documento_anulacion
    ADD CONSTRAINT fk_fg_anulacion_credito FOREIGN KEY (credito_id) REFERENCES public.fg_credito(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_documento_anulacion fk_fg_anulacion_debito; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_documento_anulacion
    ADD CONSTRAINT fk_fg_anulacion_debito FOREIGN KEY (debito_id) REFERENCES public.fg_debito(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_documento_anulacion fk_fg_anulacion_facturacion; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_documento_anulacion
    ADD CONSTRAINT fk_fg_anulacion_facturacion FOREIGN KEY (facturacion_id) REFERENCES public.fg_facturacion(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_documento_anulacion fk_fg_anulacion_usuario_creacion; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_documento_anulacion
    ADD CONSTRAINT fk_fg_anulacion_usuario_creacion FOREIGN KEY (usuario_creacion) REFERENCES public.fg_usuario(username) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_documento_anulacion fk_fg_anulacion_usuario_modificacion; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_documento_anulacion
    ADD CONSTRAINT fk_fg_anulacion_usuario_modificacion FOREIGN KEY (usuario_modificacion) REFERENCES public.fg_usuario(username) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_certificado_gnv fk_fg_certificado_gnv_taller_planta; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_certificado_gnv
    ADD CONSTRAINT fk_fg_certificado_gnv_taller_planta FOREIGN KEY (taller_planta_key) REFERENCES public.fg_planta(key) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_credito fk_fg_credito_empresa; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_credito
    ADD CONSTRAINT fk_fg_credito_empresa FOREIGN KEY (empresa_key) REFERENCES public.fg_empresa(key) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_credito fk_fg_credito_facturacion; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_credito
    ADD CONSTRAINT fk_fg_credito_facturacion FOREIGN KEY (facturacion_id) REFERENCES public.fg_facturacion(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_credito fk_fg_credito_moneda; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_credito
    ADD CONSTRAINT fk_fg_credito_moneda FOREIGN KEY (moneda_key) REFERENCES public.moneda(key) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_credito fk_fg_credito_planta; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_credito
    ADD CONSTRAINT fk_fg_credito_planta FOREIGN KEY (planta_key) REFERENCES public.fg_planta(key) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_credito fk_fg_credito_serie; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_credito
    ADD CONSTRAINT fk_fg_credito_serie FOREIGN KEY (serie_comprobante_id) REFERENCES public.fg_serie_comprobante(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_credito fk_fg_credito_usuario_creacion; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_credito
    ADD CONSTRAINT fk_fg_credito_usuario_creacion FOREIGN KEY (usuario_creacion) REFERENCES public.fg_usuario(username) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_credito fk_fg_credito_usuario_modificacion; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_credito
    ADD CONSTRAINT fk_fg_credito_usuario_modificacion FOREIGN KEY (usuario_modificacion) REFERENCES public.fg_usuario(username) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_debito fk_fg_debito_empresa; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_debito
    ADD CONSTRAINT fk_fg_debito_empresa FOREIGN KEY (empresa_key) REFERENCES public.fg_empresa(key) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_debito fk_fg_debito_facturacion; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_debito
    ADD CONSTRAINT fk_fg_debito_facturacion FOREIGN KEY (facturacion_id) REFERENCES public.fg_facturacion(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_debito fk_fg_debito_moneda; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_debito
    ADD CONSTRAINT fk_fg_debito_moneda FOREIGN KEY (moneda_key) REFERENCES public.moneda(key) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_debito fk_fg_debito_planta; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_debito
    ADD CONSTRAINT fk_fg_debito_planta FOREIGN KEY (planta_key) REFERENCES public.fg_planta(key) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_debito fk_fg_debito_serie; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_debito
    ADD CONSTRAINT fk_fg_debito_serie FOREIGN KEY (serie_comprobante_id) REFERENCES public.fg_serie_comprobante(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_debito fk_fg_debito_usuario_creacion; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_debito
    ADD CONSTRAINT fk_fg_debito_usuario_creacion FOREIGN KEY (usuario_creacion) REFERENCES public.fg_usuario(username) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_debito fk_fg_debito_usuario_modificacion; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_debito
    ADD CONSTRAINT fk_fg_debito_usuario_modificacion FOREIGN KEY (usuario_modificacion) REFERENCES public.fg_usuario(username) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_descuentocomprobante fk_fg_descom_cert; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_descuentocomprobante
    ADD CONSTRAINT fk_fg_descom_cert FOREIGN KEY (certificado_id) REFERENCES public.fg_certificado(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_descuentocomprobante fk_fg_descom_descli; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_descuentocomprobante
    ADD CONSTRAINT fk_fg_descom_descli FOREIGN KEY (descuento_cliente_id) REFERENCES public.fg_descuentocliente(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_descuentocomprobante fk_fg_descom_fact; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_descuentocomprobante
    ADD CONSTRAINT fk_fg_descom_fact FOREIGN KEY (facturacion_id) REFERENCES public.fg_facturacion(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_descuentocomprobante fk_fg_descom_orden; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_descuentocomprobante
    ADD CONSTRAINT fk_fg_descom_orden FOREIGN KEY (orden_pago_id) REFERENCES public.fg_orden_pago(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_descuentocomprobante fk_fg_descom_usu_crea; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_descuentocomprobante
    ADD CONSTRAINT fk_fg_descom_usu_crea FOREIGN KEY (usuario_creacion) REFERENCES public.fg_usuario(username) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_descuentocomprobante fk_fg_descom_usu_mod; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_descuentocomprobante
    ADD CONSTRAINT fk_fg_descom_usu_mod FOREIGN KEY (usuario_modificacion) REFERENCES public.fg_usuario(username) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_descuento fk_fg_descuento_ejecutivo; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_descuento
    ADD CONSTRAINT fk_fg_descuento_ejecutivo FOREIGN KEY (ejecutivo_id) REFERENCES public.fg_ejecutivo(id) ON UPDATE CASCADE;


--
-- Name: fg_descuento fk_fg_descuento_planta; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_descuento
    ADD CONSTRAINT fk_fg_descuento_planta FOREIGN KEY (planta_key) REFERENCES public.fg_planta(key) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_descuento fk_fg_descuento_usu_crea; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_descuento
    ADD CONSTRAINT fk_fg_descuento_usu_crea FOREIGN KEY (usuario_creacion) REFERENCES public.fg_usuario(username) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_descuento fk_fg_descuento_usu_mod; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_descuento
    ADD CONSTRAINT fk_fg_descuento_usu_mod FOREIGN KEY (usuario_modificacion) REFERENCES public.fg_usuario(username) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_descuentocliente fk_fg_descuentocliente_descuento; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_descuentocliente
    ADD CONSTRAINT fk_fg_descuentocliente_descuento FOREIGN KEY (descuento_id) REFERENCES public.fg_descuento(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: fg_descuentocliente fk_fg_descuentocliente_planta; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_descuentocliente
    ADD CONSTRAINT fk_fg_descuentocliente_planta FOREIGN KEY (planta_key) REFERENCES public.fg_planta(key) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_descuentocliente fk_fg_descuentocliente_usu_crea; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_descuentocliente
    ADD CONSTRAINT fk_fg_descuentocliente_usu_crea FOREIGN KEY (usuario_creacion) REFERENCES public.fg_usuario(username) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_descuentocliente fk_fg_descuentocliente_usu_mod; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_descuentocliente
    ADD CONSTRAINT fk_fg_descuentocliente_usu_mod FOREIGN KEY (usuario_modificacion) REFERENCES public.fg_usuario(username) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_descuentodetalle fk_fg_descuentodetalle_codigo; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_descuentodetalle
    ADD CONSTRAINT fk_fg_descuentodetalle_codigo FOREIGN KEY (descuento_cliente_id) REFERENCES public.fg_descuentocliente(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: fg_descuentodetalle fk_fg_descuentodetalle_descuento; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_descuentodetalle
    ADD CONSTRAINT fk_fg_descuentodetalle_descuento FOREIGN KEY (descuento_id) REFERENCES public.fg_descuento(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: fg_descuentodetalle fk_fg_descuentodetalle_planta; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_descuentodetalle
    ADD CONSTRAINT fk_fg_descuentodetalle_planta FOREIGN KEY (planta_key) REFERENCES public.fg_planta(key) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_descuentodetalle fk_fg_descuentodetalle_servicio; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_descuentodetalle
    ADD CONSTRAINT fk_fg_descuentodetalle_servicio FOREIGN KEY (servicio_id) REFERENCES public.fg_servicio(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: fg_descuentodetalle fk_fg_descuentodetalle_usu_crea; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_descuentodetalle
    ADD CONSTRAINT fk_fg_descuentodetalle_usu_crea FOREIGN KEY (usuario_creacion) REFERENCES public.fg_usuario(username) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_descuentodetalle fk_fg_descuentodetalle_usu_mod; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_descuentodetalle
    ADD CONSTRAINT fk_fg_descuentodetalle_usu_mod FOREIGN KEY (usuario_modificacion) REFERENCES public.fg_usuario(username) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_documento_electronico_operacion fk_fg_doc_operacion_anulacion; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_documento_electronico_operacion
    ADD CONSTRAINT fk_fg_doc_operacion_anulacion FOREIGN KEY (anulacion_id) REFERENCES public.fg_documento_anulacion(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: fg_documento_electronico_operacion fk_fg_doc_operacion_credito; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_documento_electronico_operacion
    ADD CONSTRAINT fk_fg_doc_operacion_credito FOREIGN KEY (credito_id) REFERENCES public.fg_credito(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: fg_documento_electronico_operacion fk_fg_doc_operacion_debito; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_documento_electronico_operacion
    ADD CONSTRAINT fk_fg_doc_operacion_debito FOREIGN KEY (debito_id) REFERENCES public.fg_debito(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: fg_documento_electronico_operacion fk_fg_doc_operacion_facturacion; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_documento_electronico_operacion
    ADD CONSTRAINT fk_fg_doc_operacion_facturacion FOREIGN KEY (facturacion_id) REFERENCES public.fg_facturacion(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: fg_documento_electronico_operacion fk_fg_doc_operacion_usuario; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_documento_electronico_operacion
    ADD CONSTRAINT fk_fg_doc_operacion_usuario FOREIGN KEY (usuario_creacion) REFERENCES public.fg_usuario(username) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_ejecutivo fk_fg_ejecutivo_usu_crea; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_ejecutivo
    ADD CONSTRAINT fk_fg_ejecutivo_usu_crea FOREIGN KEY (usuario_creacion) REFERENCES public.fg_usuario(username) ON UPDATE CASCADE;


--
-- Name: fg_ejecutivo fk_fg_ejecutivo_usu_mod; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_ejecutivo
    ADD CONSTRAINT fk_fg_ejecutivo_usu_mod FOREIGN KEY (usuario_modificacion) REFERENCES public.fg_usuario(username) ON UPDATE CASCADE;


--
-- Name: fg_ejecutivo fk_fg_ejecutivo_usuario; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_ejecutivo
    ADD CONSTRAINT fk_fg_ejecutivo_usuario FOREIGN KEY (username) REFERENCES public.fg_usuario(username) ON UPDATE CASCADE;


--
-- Name: fg_empresa_facturador fk_fg_empresa_facturador_empresa; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_empresa_facturador
    ADD CONSTRAINT fk_fg_empresa_facturador_empresa FOREIGN KEY (empresa_key) REFERENCES public.fg_empresa(key) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_facturacion fk_fg_facturacion_certificado; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_facturacion
    ADD CONSTRAINT fk_fg_facturacion_certificado FOREIGN KEY (certificado_id) REFERENCES public.fg_certificado(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: fg_facturacion_cuota fk_fg_facturacion_cuota_facturacion; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_facturacion_cuota
    ADD CONSTRAINT fk_fg_facturacion_cuota_facturacion FOREIGN KEY (facturacion_id) REFERENCES public.fg_facturacion(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: fg_facturacion fk_fg_facturacion_empresa; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_facturacion
    ADD CONSTRAINT fk_fg_facturacion_empresa FOREIGN KEY (empresa_key) REFERENCES public.fg_empresa(key) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_facturacion_intento fk_fg_facturacion_intento_facturacion; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_facturacion_intento
    ADD CONSTRAINT fk_fg_facturacion_intento_facturacion FOREIGN KEY (facturacion_id) REFERENCES public.fg_facturacion(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: fg_facturacion fk_fg_facturacion_moneda; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_facturacion
    ADD CONSTRAINT fk_fg_facturacion_moneda FOREIGN KEY (moneda_key) REFERENCES public.moneda(key) ON UPDATE CASCADE;


--
-- Name: fg_facturacion fk_fg_facturacion_operacion; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_facturacion
    ADD CONSTRAINT fk_fg_facturacion_operacion FOREIGN KEY (operacion_id) REFERENCES public.fg_operacion_comercial(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_facturacion fk_fg_facturacion_planta; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_facturacion
    ADD CONSTRAINT fk_fg_facturacion_planta FOREIGN KEY (planta_key) REFERENCES public.fg_planta(key) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_facturacion fk_fg_facturacion_serie_comprobante; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_facturacion
    ADD CONSTRAINT fk_fg_facturacion_serie_comprobante FOREIGN KEY (serie_comprobante_id) REFERENCES public.fg_serie_comprobante(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_operacion_comercial fk_fg_operacion_cliente; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_operacion_comercial
    ADD CONSTRAINT fk_fg_operacion_cliente FOREIGN KEY (cliente_id) REFERENCES public.fg_cliente(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: fg_operacion_detalle fk_fg_operacion_detalle_certificado; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_operacion_detalle
    ADD CONSTRAINT fk_fg_operacion_detalle_certificado FOREIGN KEY (certificado_id) REFERENCES public.fg_certificado(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_operacion_detalle fk_fg_operacion_detalle_operacion; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_operacion_detalle
    ADD CONSTRAINT fk_fg_operacion_detalle_operacion FOREIGN KEY (operacion_id) REFERENCES public.fg_operacion_comercial(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: fg_operacion_detalle fk_fg_operacion_detalle_producto; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_operacion_detalle
    ADD CONSTRAINT fk_fg_operacion_detalle_producto FOREIGN KEY (producto_facturacion_id) REFERENCES public.fg_producto_facturacion(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_operacion_detalle fk_fg_operacion_detalle_servicio; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_operacion_detalle
    ADD CONSTRAINT fk_fg_operacion_detalle_servicio FOREIGN KEY (servicio_id) REFERENCES public.fg_servicio(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_operacion_detalle fk_fg_operacion_detalle_tarifa; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_operacion_detalle
    ADD CONSTRAINT fk_fg_operacion_detalle_tarifa FOREIGN KEY (tarifa_id) REFERENCES public.fg_tarifa(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_operacion_comercial fk_fg_operacion_moneda; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_operacion_comercial
    ADD CONSTRAINT fk_fg_operacion_moneda FOREIGN KEY (moneda_key) REFERENCES public.moneda(key) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_operacion_comercial fk_fg_operacion_planta; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_operacion_comercial
    ADD CONSTRAINT fk_fg_operacion_planta FOREIGN KEY (planta_key) REFERENCES public.fg_planta(key) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_operacion_comercial fk_fg_operacion_usuario_creacion; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_operacion_comercial
    ADD CONSTRAINT fk_fg_operacion_usuario_creacion FOREIGN KEY (usuario_creacion) REFERENCES public.fg_usuario(username) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_operacion_comercial fk_fg_operacion_usuario_modificacion; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_operacion_comercial
    ADD CONSTRAINT fk_fg_operacion_usuario_modificacion FOREIGN KEY (usuario_modificacion) REFERENCES public.fg_usuario(username) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_orden_pago fk_fg_orden_pago_certificado; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_orden_pago
    ADD CONSTRAINT fk_fg_orden_pago_certificado FOREIGN KEY (certificado_id) REFERENCES public.fg_certificado(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: fg_orden_pago fk_fg_orden_pago_formapago; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_orden_pago
    ADD CONSTRAINT fk_fg_orden_pago_formapago FOREIGN KEY (formapago_key) REFERENCES public.formapago(key) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_orden_pago fk_fg_orden_pago_moneda; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_orden_pago
    ADD CONSTRAINT fk_fg_orden_pago_moneda FOREIGN KEY (moneda_key) REFERENCES public.moneda(key) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_orden_pago fk_fg_orden_pago_operacion; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_orden_pago
    ADD CONSTRAINT fk_fg_orden_pago_operacion FOREIGN KEY (operacion_id) REFERENCES public.fg_operacion_comercial(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_pago fk_fg_pago_cuenta; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_pago
    ADD CONSTRAINT fk_fg_pago_cuenta FOREIGN KEY (cuentacorriente_key) REFERENCES public.cuentacorriente(key) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_pago fk_fg_pago_entidad; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_pago
    ADD CONSTRAINT fk_fg_pago_entidad FOREIGN KEY (entidadfinanciera_key) REFERENCES public.entidadfinanciera(key) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_pago fk_fg_pago_moneda; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_pago
    ADD CONSTRAINT fk_fg_pago_moneda FOREIGN KEY (moneda_key) REFERENCES public.moneda(key) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_pago fk_fg_pago_orden; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_pago
    ADD CONSTRAINT fk_fg_pago_orden FOREIGN KEY (orden_pago_id) REFERENCES public.fg_orden_pago(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: fg_pago fk_fg_pago_tarjeta; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_pago
    ADD CONSTRAINT fk_fg_pago_tarjeta FOREIGN KEY (tarjeta_key) REFERENCES public.tarjeta(key) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_pago fk_fg_pago_tipo_contado; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_pago
    ADD CONSTRAINT fk_fg_pago_tipo_contado FOREIGN KEY (tipocontado_key) REFERENCES public.tipocontado(key) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_planta fk_fg_planta_empresa; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_planta
    ADD CONSTRAINT fk_fg_planta_empresa FOREIGN KEY (empresa_key) REFERENCES public.fg_empresa(key) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_perfil_permiso fk_fg_pp_perfil; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_perfil_permiso
    ADD CONSTRAINT fk_fg_pp_perfil FOREIGN KEY (perfil_clave) REFERENCES public.fg_perfil(clave);


--
-- Name: fg_perfil_permiso fk_fg_pp_permiso; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_perfil_permiso
    ADD CONSTRAINT fk_fg_pp_permiso FOREIGN KEY (permiso_clave) REFERENCES public.fg_permiso(clave);


--
-- Name: fg_producto_facturacion fk_fg_producto_facturacion_categoria; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_producto_facturacion
    ADD CONSTRAINT fk_fg_producto_facturacion_categoria FOREIGN KEY (categoria_id) REFERENCES public.fg_categoria_servicio(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_producto_facturacion fk_fg_producto_facturacion_chip; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_producto_facturacion
    ADD CONSTRAINT fk_fg_producto_facturacion_chip FOREIGN KEY (producto_chip_id) REFERENCES public.fg_producto_inventariable(id) ON DELETE RESTRICT;


--
-- Name: fg_producto_inventariable_sede fk_fg_producto_inventariable_sede_producto_facturacion; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_producto_inventariable_sede
    ADD CONSTRAINT fk_fg_producto_inventariable_sede_producto_facturacion FOREIGN KEY (producto_facturacion_id) REFERENCES public.fg_producto_facturacion(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_producto_sede fk_fg_producto_sede_planta; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_producto_sede
    ADD CONSTRAINT fk_fg_producto_sede_planta FOREIGN KEY (planta_key) REFERENCES public.fg_planta(key) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_producto_sede fk_fg_producto_sede_producto; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_producto_sede
    ADD CONSTRAINT fk_fg_producto_sede_producto FOREIGN KEY (producto_facturacion_id) REFERENCES public.fg_producto_facturacion(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_serie_comprobante fk_fg_serie_comprobante_planta; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_serie_comprobante
    ADD CONSTRAINT fk_fg_serie_comprobante_planta FOREIGN KEY (planta_key) REFERENCES public.fg_planta(key) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_serie_comprobante fk_fg_serie_empresa; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_serie_comprobante
    ADD CONSTRAINT fk_fg_serie_empresa FOREIGN KEY (empresa_key) REFERENCES public.fg_empresa(key) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_servicio fk_fg_servicio_categoria; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_servicio
    ADD CONSTRAINT fk_fg_servicio_categoria FOREIGN KEY (categoria_id) REFERENCES public.fg_categoria_servicio(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_taller_autorizado fk_fg_taller_autorizado_planta; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_taller_autorizado
    ADD CONSTRAINT fk_fg_taller_autorizado_planta FOREIGN KEY (planta_key) REFERENCES public.fg_planta(key) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_tarifa fk_fg_tarifa_planta; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_tarifa
    ADD CONSTRAINT fk_fg_tarifa_planta FOREIGN KEY (planta_key) REFERENCES public.fg_planta(key);


--
-- Name: fg_tarifa fk_fg_tarifa_producto_facturacion; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_tarifa
    ADD CONSTRAINT fk_fg_tarifa_producto_facturacion FOREIGN KEY (producto_facturacion_id) REFERENCES public.fg_producto_facturacion(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_tarifa fk_fg_tarifa_servicio; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_tarifa
    ADD CONSTRAINT fk_fg_tarifa_servicio FOREIGN KEY (servicio_id) REFERENCES public.fg_servicio(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: fg_usuario_planta fk_fg_up_planta; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_usuario_planta
    ADD CONSTRAINT fk_fg_up_planta FOREIGN KEY (plantas_key) REFERENCES public.fg_planta(key);


--
-- Name: fg_usuario_planta fk_fg_up_usuario; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_usuario_planta
    ADD CONSTRAINT fk_fg_up_usuario FOREIGN KEY (usuario_username) REFERENCES public.fg_usuario(username) ON UPDATE CASCADE;


--
-- Name: fg_usuario_sesion fk_fg_us_planta; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_usuario_sesion
    ADD CONSTRAINT fk_fg_us_planta FOREIGN KEY (planta_key) REFERENCES public.fg_planta(key);


--
-- Name: fg_usuario_sesion fk_fg_us_usuario; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_usuario_sesion
    ADD CONSTRAINT fk_fg_us_usuario FOREIGN KEY (usuario_username) REFERENCES public.fg_usuario(username) ON UPDATE CASCADE;


--
-- Name: fg_usuario fk_fg_usuario_perfil; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_usuario
    ADD CONSTRAINT fk_fg_usuario_perfil FOREIGN KEY (perfil_id) REFERENCES public.fg_perfil(clave);


--
-- Name: fg_usuario fk_fg_usuario_persona; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_usuario
    ADD CONSTRAINT fk_fg_usuario_persona FOREIGN KEY (persona_nrodocumentoidentidad) REFERENCES public.persona(nrodocumentoidentidad) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: fg_vehiculo fk_fg_vehiculo_certificado_origen; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_vehiculo
    ADD CONSTRAINT fk_fg_vehiculo_certificado_origen FOREIGN KEY (certificado_origen_id) REFERENCES public.fg_certificado(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: fg_vehiculo fk_fg_vehiculo_usuario_creacion; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_vehiculo
    ADD CONSTRAINT fk_fg_vehiculo_usuario_creacion FOREIGN KEY (usuario_creacion) REFERENCES public.fg_usuario(username) ON UPDATE CASCADE;


--
-- Name: fg_vehiculo fk_fg_vehiculo_usuario_modificacion; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fg_vehiculo
    ADD CONSTRAINT fk_fg_vehiculo_usuario_modificacion FOREIGN KEY (usuario_modificacion) REFERENCES public.fg_usuario(username) ON UPDATE CASCADE;


--
-- Solicitudes pagadas de duplicados de certificados FAREGAS.
-- Conserva una copia inmutable de la representacion emitida; nunca crea ni
-- modifica un certificado tecnico ni consume un correlativo de certificado.
--

CREATE TABLE public.fg_certificado_duplicado (
    id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
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
    CONSTRAINT ck_fg_certificado_duplicado_estado CHECK (((estado)::text = ANY ((ARRAY['PENDIENTE_PAGO'::character varying, 'PENDIENTE_COMPROBANTE'::character varying, 'DISPONIBLE'::character varying, 'ANULADO'::character varying])::text[]))),
    CONSTRAINT ck_fg_certificado_duplicado_modalidad CHECK (((modalidad)::text = ANY ((ARRAY['INICIAL'::character varying, 'ANUAL'::character varying])::text[]))),
    CONSTRAINT ck_fg_certificado_duplicado_motivo CHECK (((motivo)::text = 'PERDIDA'::text)),
    CONSTRAINT ck_fg_certificado_duplicado_precio CHECK ((precio = 50.00)),
    CONSTRAINT ck_fg_certificado_duplicado_descargas CHECK ((cantidad_descargas >= 0)),
    CONSTRAINT uq_fg_certificado_duplicado_operacion UNIQUE (operacion_id),
    CONSTRAINT uq_fg_certificado_duplicado_facturacion UNIQUE (facturacion_id),
    CONSTRAINT fk_fg_certificado_duplicado_certificado FOREIGN KEY (certificado_original_id) REFERENCES public.fg_certificado(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_fg_certificado_duplicado_operacion FOREIGN KEY (operacion_id) REFERENCES public.fg_operacion_comercial(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_fg_certificado_duplicado_facturacion FOREIGN KEY (facturacion_id) REFERENCES public.fg_facturacion(id) ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT fk_fg_certificado_duplicado_planta FOREIGN KEY (planta_key) REFERENCES public.fg_planta(key) ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE INDEX idx_fg_certificado_duplicado_busqueda
    ON public.fg_certificado_duplicado (planta_key, placa, tipo_certificado_clave, modalidad, fecha_emision_snapshot DESC);

CREATE INDEX idx_fg_certificado_duplicado_original
    ON public.fg_certificado_duplicado (certificado_original_id);

CREATE INDEX idx_fg_certificado_duplicado_estado
    ON public.fg_certificado_duplicado (estado, fecha_solicitud DESC);

CREATE UNIQUE INDEX uq_fg_certificado_duplicado_pendiente_usuario
    ON public.fg_certificado_duplicado (certificado_original_id, solicitado_por)
    WHERE ((estado)::text = 'PENDIENTE_PAGO'::text);


--
-- Catálogo y asignaciones iniciales de operaciones fiscales sensibles.
-- El esquema maestro representa una instalación nueva; las bases existentes
-- deben usar 20261022_faregas_fase0_seguridad_documentos.sql.
--

INSERT INTO public.fg_permiso (clave, nombre, modulo, descripcion, activo)
VALUES
    ('FAREGAS_ANULAR_COMPROBANTE', 'Anular comprobante electrónico FAREGAS', 'FAREGAS', 'Permite iniciar la baja fiscal de comprobantes electrónicos FAREGAS; no anula certificados técnicos ni devuelve pagos.', TRUE),
    ('FAREGAS_NOTA_CREDITO', 'Emitir nota de crédito FAREGAS', 'FAREGAS', 'Permite emitir notas de crédito vinculadas a comprobantes FAREGAS.', TRUE)
ON CONFLICT (clave) DO UPDATE
SET nombre = EXCLUDED.nombre,
    modulo = EXCLUDED.modulo,
    descripcion = EXCLUDED.descripcion,
    activo = EXCLUDED.activo;

INSERT INTO public.fg_perfil_permiso (perfil_clave, permiso_clave)
SELECT perfil.clave, permiso.clave
FROM public.fg_perfil perfil
CROSS JOIN (
    VALUES
        ('FAREGAS_ANULAR_COMPROBANTE'::varchar),
        ('FAREGAS_NOTA_CREDITO'::varchar)
) permiso(clave)
WHERE perfil.clave = 'SISTEMAS'
ON CONFLICT (perfil_clave, permiso_clave) DO NOTHING;


--
-- PostgreSQL database dump complete
--

--
-- FAREGAS FASE 1: solicitudes administrativas de anulación y rectificación.
-- La aprobación es únicamente administrativa y no ejecuta efectos técnicos o
-- fiscales. Para bases existentes use la migración incremental 20261022.
--

CREATE TABLE public.fg_solicitud_operacion (
    id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    tipo_operacion varchar(40) NOT NULL,
    certificado_id bigint,
    facturacion_id bigint,
    empresa_key varchar NOT NULL,
    planta_key varchar(20) NOT NULL,
    usuario_solicitante varchar(255) NOT NULL,
    motivo varchar(500) NOT NULL,
    observaciones text,
    estado varchar(40) NOT NULL DEFAULT 'PENDIENTE_APROBACION',
    usuario_decision varchar(255),
    fecha_solicitud timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_decision timestamptz,
    justificacion_decision varchar(1000),
    datos_originales_certificado jsonb,
    datos_originales_comprobante jsonb,
    datos_propuestos jsonb,
    fecha_emision_original date,
    resultado_tecnico jsonb,
    resultado_fiscal jsonb,
    idempotencia_clave uuid NOT NULL,
    usuario_ejecucion varchar(255),
    fecha_ejecucion timestamptz,
    idempotencia_ejecucion uuid,
    autorizacion_autoejecucion boolean NOT NULL DEFAULT FALSE,
    version integer NOT NULL DEFAULT 1,
    fecha_creacion timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_modificacion timestamptz,
    CONSTRAINT fk_fg_solicitud_certificado FOREIGN KEY (certificado_id) REFERENCES public.fg_certificado(id) ON DELETE RESTRICT,
    CONSTRAINT fk_fg_solicitud_facturacion FOREIGN KEY (facturacion_id) REFERENCES public.fg_facturacion(id) ON DELETE RESTRICT,
    CONSTRAINT fk_fg_solicitud_empresa FOREIGN KEY (empresa_key) REFERENCES public.fg_empresa(key) ON DELETE RESTRICT,
    CONSTRAINT fk_fg_solicitud_planta FOREIGN KEY (planta_key) REFERENCES public.fg_planta(key) ON DELETE RESTRICT,
    CONSTRAINT fk_fg_solicitud_solicitante FOREIGN KEY (usuario_solicitante) REFERENCES public.fg_usuario(username) ON DELETE RESTRICT,
    CONSTRAINT fk_fg_solicitud_decisor FOREIGN KEY (usuario_decision) REFERENCES public.fg_usuario(username) ON DELETE RESTRICT,
    CONSTRAINT fk_fg_solicitud_ejecutor FOREIGN KEY (usuario_ejecucion) REFERENCES public.fg_usuario(username) ON DELETE RESTRICT,
    CONSTRAINT ck_fg_solicitud_tipo CHECK (tipo_operacion IN ('ANULAR_CERTIFICADO', 'ANULAR_COMPROBANTE', 'ANULAR_AMBOS', 'RECTIFICAR_CERTIFICADO', 'RECTIFICAR_COMPROBANTE', 'RECTIFICAR_AMBOS')),
    CONSTRAINT ck_fg_solicitud_estado CHECK (estado IN ('PENDIENTE_APROBACION', 'APROBADA', 'RECHAZADA', 'CANCELADA', 'EN_EJECUCION', 'COMPLETADA', 'ERROR', 'REQUIERE_INTERVENCION')),
    CONSTRAINT ck_fg_solicitud_documentos CHECK (
        (tipo_operacion IN ('ANULAR_CERTIFICADO', 'RECTIFICAR_CERTIFICADO') AND certificado_id IS NOT NULL)
        OR (tipo_operacion IN ('ANULAR_COMPROBANTE', 'RECTIFICAR_COMPROBANTE') AND facturacion_id IS NOT NULL)
        OR (tipo_operacion = 'ANULAR_AMBOS' AND certificado_id IS NOT NULL)
        OR (tipo_operacion = 'RECTIFICAR_AMBOS' AND certificado_id IS NOT NULL AND facturacion_id IS NOT NULL)
    ),
    CONSTRAINT ck_fg_solicitud_motivo CHECK (btrim(motivo) <> ''),
    CONSTRAINT ck_fg_solicitud_version CHECK (version > 0),
    CONSTRAINT ck_fg_solicitud_no_autoejecucion CHECK (
        usuario_ejecucion IS NULL
        OR usuario_ejecucion IS DISTINCT FROM usuario_solicitante
        OR (usuario_ejecucion = usuario_solicitante AND autorizacion_autoejecucion = TRUE)
    ),
    CONSTRAINT uq_fg_solicitud_idempotencia UNIQUE (usuario_solicitante, idempotencia_clave)
);

CREATE TABLE public.fg_solicitud_operacion_evento (
    id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    solicitud_id bigint NOT NULL REFERENCES public.fg_solicitud_operacion(id) ON DELETE RESTRICT,
    tipo_evento varchar(50) NOT NULL,
    estado_anterior varchar(40),
    estado_posterior varchar(40) NOT NULL,
    usuario_responsable varchar(255) NOT NULL REFERENCES public.fg_usuario(username) ON DELETE RESTRICT,
    fecha_evento timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    comentario text,
    metadatos jsonb,
    CONSTRAINT ck_fg_solicitud_evento_anterior CHECK (estado_anterior IS NULL OR estado_anterior IN ('PENDIENTE_APROBACION', 'APROBADA', 'RECHAZADA', 'CANCELADA', 'EN_EJECUCION', 'COMPLETADA', 'ERROR', 'REQUIERE_INTERVENCION')),
    CONSTRAINT ck_fg_solicitud_evento_posterior CHECK (estado_posterior IN ('PENDIENTE_APROBACION', 'APROBADA', 'RECHAZADA', 'CANCELADA', 'EN_EJECUCION', 'COMPLETADA', 'ERROR', 'REQUIERE_INTERVENCION'))
);

CREATE INDEX idx_fg_solicitud_planta ON public.fg_solicitud_operacion (planta_key, fecha_solicitud DESC);
CREATE INDEX idx_fg_solicitud_empresa ON public.fg_solicitud_operacion (empresa_key, fecha_solicitud DESC);
CREATE INDEX idx_fg_solicitud_estado ON public.fg_solicitud_operacion (estado, fecha_solicitud DESC);
CREATE INDEX idx_fg_solicitud_tipo ON public.fg_solicitud_operacion (tipo_operacion, fecha_solicitud DESC);
CREATE INDEX idx_fg_solicitud_cert_tipo_estado ON public.fg_solicitud_operacion (certificado_id, tipo_operacion, estado, fecha_solicitud DESC);
CREATE INDEX idx_fg_solicitud_solicitante ON public.fg_solicitud_operacion (usuario_solicitante, fecha_solicitud DESC);
CREATE INDEX idx_fg_solicitud_ejecutor ON public.fg_solicitud_operacion (usuario_ejecucion, fecha_ejecucion DESC)
    WHERE usuario_ejecucion IS NOT NULL;
CREATE INDEX idx_fg_solicitud_evento_historial ON public.fg_solicitud_operacion_evento (solicitud_id, fecha_evento, id);
CREATE UNIQUE INDEX uq_fg_solicitud_activa_certificado ON public.fg_solicitud_operacion (certificado_id)
    WHERE certificado_id IS NOT NULL AND estado IN ('PENDIENTE_APROBACION', 'APROBADA', 'EN_EJECUCION', 'REQUIERE_INTERVENCION');
CREATE UNIQUE INDEX uq_fg_solicitud_activa_facturacion ON public.fg_solicitud_operacion (facturacion_id)
    WHERE facturacion_id IS NOT NULL AND estado IN ('PENDIENTE_APROBACION', 'APROBADA', 'EN_EJECUCION', 'REQUIERE_INTERVENCION');

CREATE FUNCTION public.fg_bloquear_mutacion_solicitud_evento()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'El historial de solicitudes administrativas es inmutable.' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER trg_fg_solicitud_evento_inmutable
BEFORE UPDATE OR DELETE ON public.fg_solicitud_operacion_evento
FOR EACH ROW EXECUTE FUNCTION public.fg_bloquear_mutacion_solicitud_evento();

INSERT INTO public.fg_permiso (clave, nombre, modulo, descripcion, activo)
VALUES
    ('FAREGAS_SOLICITUD_CREAR', 'Solicitar anulación total', 'FAREGAS', 'Permite a un perfil autorizado por RBAC solicitar la anulación total sin aprobarla ni ejecutarla.', TRUE),
    ('FAREGAS_SOLICITUD_VER', 'Consultar solicitudes de anulación', 'FAREGAS', 'Permite consultar solicitudes dentro del alcance autorizado.', TRUE),
    ('FAREGAS_SOLICITUD_APROBAR', 'Aprobar anulaciones', 'FAREGAS', 'Permite aprobar solicitudes de anulación dentro del alcance autorizado.', TRUE),
    ('FAREGAS_SOLICITUD_AUTOAPROBAR', 'Autoaprobar anulación excepcional', 'FAREGAS', 'Permite aprobar excepcionalmente una solicitud propia con justificación y confirmación explícitas. No habilita la ejecución fiscal.', TRUE),
    ('FAREGAS_SOLICITUD_AUTOEJECUTAR', 'Autoejecución excepcional de anulación', 'FAREGAS', 'Permite ejecutar una solicitud propia previamente aprobada, con confirmación explícita, justificación obligatoria y auditoría inmutable.', TRUE),
    ('FAREGAS_SOLICITUD_RECHAZAR', 'Rechazar anulaciones', 'FAREGAS', 'Permite rechazar solicitudes de otro usuario dentro del alcance autorizado.', TRUE),
    ('FAREGAS_SOLICITUD_ADMINISTRAR', 'Administrar solicitudes de anulación', 'FAREGAS', 'Permite administrar solicitudes sin omitir la separación de funciones.', TRUE),
    ('FAREGAS_CERTIFICADO_ANULAR_EJECUTAR', 'Ejecutar anulación autorizada', 'FAREGAS', 'Permite iniciar la ejecución de una anulación total aprobada y ajena dentro del alcance autorizado.', TRUE),
    ('FAREGAS_CERTIFICADO_RECTIFICAR_EJECUTAR', 'Rectificar directamente un certificado', 'FAREGAS', 'Permite rectificar directamente un certificado emitido, con versionado y auditoría, sin alterar comprobantes, pagos, fecha original ni correlativo DG.', TRUE)
ON CONFLICT (clave) DO UPDATE SET nombre = EXCLUDED.nombre, modulo = EXCLUDED.modulo, descripcion = EXCLUDED.descripcion, activo = EXCLUDED.activo;

INSERT INTO public.fg_perfil_permiso (perfil_clave, permiso_clave)
SELECT perfil.clave, permiso.clave
FROM public.fg_perfil perfil
JOIN (VALUES
    ('OPERADOR'::varchar, 'FAREGAS_SOLICITUD_CREAR'::varchar),
    ('OPERADOR'::varchar, 'FAREGAS_SOLICITUD_VER'::varchar),
    ('JEFE_PLANTA'::varchar, 'FAREGAS_SOLICITUD_VER'::varchar),
    ('SISTEMAS'::varchar, 'FAREGAS_SOLICITUD_CREAR'::varchar),
    ('SISTEMAS'::varchar, 'FAREGAS_SOLICITUD_VER'::varchar),
    ('SISTEMAS'::varchar, 'FAREGAS_SOLICITUD_APROBAR'::varchar),
    ('SISTEMAS'::varchar, 'FAREGAS_SOLICITUD_AUTOAPROBAR'::varchar),
    ('SISTEMAS'::varchar, 'FAREGAS_SOLICITUD_RECHAZAR'::varchar),
    ('SISTEMAS'::varchar, 'FAREGAS_SOLICITUD_ADMINISTRAR'::varchar),
    ('SISTEMAS'::varchar, 'FAREGAS_CERTIFICADO_ANULAR_EJECUTAR'::varchar),
    ('SISTEMAS'::varchar, 'FAREGAS_CERTIFICADO_RECTIFICAR_EJECUTAR'::varchar)
) permiso(perfil_clave, clave) ON permiso.perfil_clave = perfil.clave
ON CONFLICT (perfil_clave, permiso_clave) DO NOTHING;

-- ============================================================================
-- FASE 3: VERSIONADO DE CERTIFICADOS
-- ============================================================================
CREATE TABLE public.fg_certificado_version (
    id bigserial PRIMARY KEY,
    certificado_id bigint NOT NULL REFERENCES public.fg_certificado(id) ON DELETE RESTRICT,
    solicitud_id bigint REFERENCES public.fg_solicitud_operacion(id) ON DELETE SET NULL,
    numero_version integer NOT NULL,
    estado_version varchar(30) NOT NULL,
    es_vigente boolean NOT NULL DEFAULT FALSE,
    fecha_emision_original date NOT NULL,
    fecha_version timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_aplicacion_oficial timestamptz,
    usuario_creacion varchar(255) NOT NULL REFERENCES public.fg_usuario(username) ON DELETE RESTRICT,
    usuario_aprobacion varchar(255) REFERENCES public.fg_usuario(username) ON DELETE RESTRICT,
    motivo text NOT NULL,
    snapshot_datos jsonb NOT NULL,
    diferencias jsonb,
    enlace_pdf_original text,
    enlace_pdf_version text,
    metadatos jsonb,
    CONSTRAINT ck_fg_certificado_version_estado CHECK (
        estado_version IN ('ORIGINAL', 'PROPUESTA', 'PREPARADA', 'VIGENTE', 'SUSTITUIDA', 'RECHAZADA')
    ),
    CONSTRAINT uq_fg_certificado_version_num UNIQUE (certificado_id, numero_version)
);

CREATE INDEX idx_fg_cert_ver_certificado ON public.fg_certificado_version (certificado_id, numero_version DESC);
CREATE INDEX idx_fg_cert_ver_solicitud ON public.fg_certificado_version (solicitud_id);
CREATE INDEX idx_fg_cert_ver_estado ON public.fg_certificado_version (estado_version, fecha_version DESC);
CREATE UNIQUE INDEX uq_fg_cert_ver_unica_vigente ON public.fg_certificado_version (certificado_id)
    WHERE es_vigente = TRUE;

COMMIT;
