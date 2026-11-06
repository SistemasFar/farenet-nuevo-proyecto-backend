BEGIN;

-- Publica una nueva versión sin modificar la VIGENTE histórica. Los
-- certificados emitidos que ya fijaron formato_version_id conservan su HTML.
DO $migration$
DECLARE
    variante RECORD;
    v_version_id INTEGER;
    v_config JSONB;
    v_html TEXT;
    v_next_version INTEGER;
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
        SELECT id, configuracion
          INTO v_version_id, v_config
          FROM fg_certificado_formato_version
         WHERE formato_id = variante.id
           AND estado = 'VIGENTE'
         ORDER BY version DESC
         LIMIT 1
         FOR UPDATE;

        IF v_version_id IS NULL THEN
            CONTINUE;
        END IF;

        v_html := COALESCE(v_config->>'html', '');
        IF v_html LIKE '%{{certificado.titulo}}%' THEN
            CONTINUE;
        END IF;

        v_html := replace(
            v_html,
            '<h1 class="titulo-principal">CERTIFICADO DE INSPECCIÓN DE TALLER</h1>',
            '<h1 class="titulo-principal"><span data-faregas-var="certificado.titulo" data-faregas-label="Título del Certificado" data-faregas-fallback="" data-faregas-source="FORM">{{certificado.titulo}}</span></h1>'
        );

        IF v_html NOT LIKE '%{{certificado.titulo}}%' THEN
            RAISE EXCEPTION 'No se pudo actualizar el título de %', variante.codigo;
        END IF;

        v_config := jsonb_set(v_config, '{html}', to_jsonb(v_html), TRUE);
        IF NOT COALESCE(v_config->'variables_usadas', '[]'::jsonb) ? 'certificado.titulo' THEN
            v_config := jsonb_set(
                v_config,
                '{variables_usadas}',
                COALESCE(v_config->'variables_usadas', '[]'::jsonb) || '"certificado.titulo"'::jsonb,
                TRUE
            );
        END IF;

        SELECT COALESCE(MAX(version), 0) + 1
          INTO v_next_version
          FROM fg_certificado_formato_version
         WHERE formato_id = variante.id;

        UPDATE fg_certificado_formato_version
           SET estado = 'RETIRADA'
         WHERE id = v_version_id;

        INSERT INTO fg_certificado_formato_version
            (formato_id, version, archivo_ruta, configuracion, estado, vigente_desde, motor)
        VALUES
            (variante.id, v_next_version, 'HTML', v_config, 'VIGENTE', CURRENT_TIMESTAMP, 'HTML_DINAMICO');
    END LOOP;
END
$migration$;

COMMIT;
