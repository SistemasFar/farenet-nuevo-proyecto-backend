BEGIN;

-- Prepara una versión editable por cada variante de inspección de taller y
-- aproxima su composición al certificado físico entregado. Si el usuario ya
-- estaba trabajando en un BORRADOR, se conserva todo su contenido y sólo se
-- agrega/actualiza esta hoja de estilo de presentación.
DO $migration$
DECLARE
    variante RECORD;
    v_draft_id INTEGER;
    v_config JSONB;
    v_html TEXT;
    v_next_version INTEGER;
    v_style TEXT := $style$<style id="faregas-taller-layout-reference">
  .documento-certificado { padding: 10mm 24mm 15mm; font-size: 10px; line-height: 1.35; }
  .cabecera-legal { width: 60mm; margin-bottom: 14mm; font-size: 8.5px; line-height: 1.25; text-align: center; }
  .titulo-principal { margin: 0 0 14mm; font-size: 14px; font-weight: 700; text-align: center; }
  .sub-header { gap: 12mm; margin-bottom: 14mm; font-size: 10.5px; }
  .parrafo { margin: 0 0 8mm; text-align: justify; }
  .certifica { margin: 0 0 4mm; }
  .tabla-info { width: 100%; margin: 0 0 8mm; border-collapse: collapse; table-layout: fixed; font-size: 9.5px; }
  .tabla-info col:nth-child(1) { width: 5% !important; min-width: 0 !important; }
  .tabla-info col:nth-child(2) { width: 25% !important; min-width: 0 !important; }
  .tabla-info col:nth-child(3) { width: 70% !important; min-width: 0 !important; }
  .tabla-info td { border: 1px solid #777; padding: 1.1mm 1.8mm; vertical-align: middle; }
  .tabla-info td:nth-child(1) { width: 5%; text-align: center; }
  .tabla-info td:nth-child(2) { width: 25%; }
  .tabla-info td:nth-child(3) { width: 70%; }
  .tabla-info p { margin: 0; }
  .seccion-final { margin-top: 5mm; }
  .seccion-final p { margin: 0 0 7mm; }
  .fecha-expedicion { margin-top: 14mm; }
</style>$style$;
BEGIN
    FOR variante IN
        SELECT id, codigo
          FROM fg_certificado_formato
         WHERE codigo IN (
            'TALLER_GNV_INICIAL_FORMATO',
            'TALLER_GNV_ANUAL_FORMATO',
            'TALLER_GLP_INICIAL_FORMATO',
            'TALLER_GLP_ANUAL_FORMATO'
         )
         ORDER BY id
         FOR UPDATE
    LOOP
        v_draft_id := NULL;
        v_config := NULL;

        SELECT id, configuracion
          INTO v_draft_id, v_config
          FROM fg_certificado_formato_version
         WHERE formato_id = variante.id
           AND estado = 'BORRADOR'
         ORDER BY version DESC
         LIMIT 1
         FOR UPDATE;

        IF v_draft_id IS NULL THEN
            SELECT configuracion
              INTO v_config
              FROM fg_certificado_formato_version
             WHERE formato_id = variante.id
               AND estado = 'VIGENTE'
             ORDER BY version DESC
             LIMIT 1;

            IF v_config IS NULL THEN
                CONTINUE;
            END IF;

            SELECT COALESCE(MAX(version), 0) + 1
              INTO v_next_version
              FROM fg_certificado_formato_version
             WHERE formato_id = variante.id;

            INSERT INTO fg_certificado_formato_version
                (formato_id, version, archivo_ruta, configuracion, estado, vigente_desde, motor)
            VALUES
                (variante.id, v_next_version, 'HTML', v_config, 'BORRADOR', NULL, 'HTML_DINAMICO')
            RETURNING id INTO v_draft_id;
        END IF;

        v_html := COALESCE(v_config->>'html', '');
        IF v_html = '' OR position('</head>' IN lower(v_html)) = 0 THEN
            RAISE EXCEPTION 'El borrador % de % no contiene un documento HTML completo', v_draft_id, variante.codigo;
        END IF;

        IF v_html LIKE '%id="faregas-taller-layout-reference"%' THEN
            v_html := regexp_replace(
                v_html,
                '<style id="faregas-taller-layout-reference">.*?</style>',
                v_style,
                'gis'
            );
        ELSE
            v_html := regexp_replace(v_html, '</head>', v_style || E'\n</head>', 'i');
        END IF;

        v_config := jsonb_set(v_config, '{html}', to_jsonb(v_html), TRUE);
        IF NOT v_config ? 'margenes_pagina_mm' THEN
            v_config := jsonb_set(
                v_config,
                '{margenes_pagina_mm}',
                '{"top":10,"right":24,"bottom":15,"left":24}'::jsonb,
                TRUE
            );
        END IF;

        UPDATE fg_certificado_formato_version
           SET configuracion = v_config
         WHERE id = v_draft_id;
    END LOOP;
END
$migration$;

COMMIT;
