--
-- FAREGAS FASE 4D: Corregir restricción ck_fg_solicitud_documentos para EMITIR_NOTA_CREDITO
--
-- La restricción actual no incluye EMITIR_NOTA_CREDITO en ninguna de sus condiciones,
-- lo que impide insertar solicitudes de autorización de nota de crédito.
--
-- Se agrega la condición para EMITIR_NOTA_CREDITO requiriendo tanto certificado_id
-- como facturacion_id NOT NULL (igual que RECTIFICAR_AMBOS), ya que la nota de crédito
-- referencia tanto al certificado como al comprobante electrónico original.
--
-- No modifica datos existentes ni solicitudes históricas.

ALTER TABLE public.fg_solicitud_operacion DROP CONSTRAINT IF EXISTS ck_fg_solicitud_documentos;

ALTER TABLE public.fg_solicitud_operacion ADD CONSTRAINT ck_fg_solicitud_documentos CHECK (
    (((tipo_operacion)::text = ANY ((ARRAY['ANULAR_CERTIFICADO'::character varying, 'RECTIFICAR_CERTIFICADO'::character varying])::text[])) AND (certificado_id IS NOT NULL))
    OR (((tipo_operacion)::text = ANY ((ARRAY['ANULAR_COMPROBANTE'::character varying, 'RECTIFICAR_COMPROBANTE'::character varying])::text[])) AND (facturacion_id IS NOT NULL))
    OR (((tipo_operacion)::text = 'ANULAR_AMBOS'::text) AND (certificado_id IS NOT NULL))
    OR (((tipo_operacion)::text = 'RECTIFICAR_AMBOS'::text) AND (certificado_id IS NOT NULL) AND (facturacion_id IS NOT NULL))
    OR (((tipo_operacion)::text = 'EMITIR_NOTA_CREDITO'::text) AND (certificado_id IS NOT NULL) AND (facturacion_id IS NOT NULL))
);
