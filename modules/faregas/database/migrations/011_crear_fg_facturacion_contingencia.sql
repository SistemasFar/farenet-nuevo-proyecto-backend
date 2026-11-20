BEGIN;

CREATE TABLE public.fg_facturacion_contingencia (
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

CREATE INDEX fg_contingencia_fiscal_pendiente_idx
    ON public.fg_facturacion_contingencia (siguiente_intento, facturacion_id)
    WHERE estado = 'PENDIENTE';

CREATE INDEX fg_contingencia_correo_pendiente_idx
    ON public.fg_facturacion_contingencia (correo_proximo, facturacion_id)
    WHERE estado = 'REGULARIZADO' AND correo_estado = 'PENDIENTE';

COMMIT;
