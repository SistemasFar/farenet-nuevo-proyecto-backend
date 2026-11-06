BEGIN;

-- Solicitud administrativa exclusivamente fiscal. No anula ni rectifica el
-- certificado técnico y reutiliza la trazabilidad de fg_solicitud_operacion.
ALTER TABLE public.fg_solicitud_operacion
    DROP CONSTRAINT IF EXISTS ck_fg_solicitud_tipo;

ALTER TABLE public.fg_solicitud_operacion
    ADD CONSTRAINT ck_fg_solicitud_tipo CHECK (tipo_operacion IN (
        'ANULAR_CERTIFICADO',
        'ANULAR_COMPROBANTE',
        'ANULAR_AMBOS',
        'EMITIR_NOTA_CREDITO',
        'RECTIFICAR_CERTIFICADO',
        'RECTIFICAR_COMPROBANTE',
        'RECTIFICAR_AMBOS'
    ));

ALTER TABLE public.fg_solicitud_operacion
    DROP CONSTRAINT IF EXISTS ck_fg_solicitud_documentos;

ALTER TABLE public.fg_solicitud_operacion
    ADD CONSTRAINT ck_fg_solicitud_documentos CHECK (
        (tipo_operacion IN ('ANULAR_CERTIFICADO', 'RECTIFICAR_CERTIFICADO') AND certificado_id IS NOT NULL)
        OR (tipo_operacion IN ('ANULAR_COMPROBANTE', 'EMITIR_NOTA_CREDITO', 'RECTIFICAR_COMPROBANTE') AND facturacion_id IS NOT NULL)
        OR (tipo_operacion = 'ANULAR_AMBOS' AND certificado_id IS NOT NULL)
        OR (tipo_operacion = 'RECTIFICAR_AMBOS' AND certificado_id IS NOT NULL AND facturacion_id IS NOT NULL)
    );

COMMIT;
