BEGIN;

-- Fuente técnica compartida por las cuatro variantes de inspección de taller.
-- Permanece inactiva para que nadie pueda asignarla directamente.
INSERT INTO fg_certificado_formato
    (codigo, nombre, motor, es_protegido, activo)
VALUES
    ('TALLER_INSPECCION_BASE', 'Base técnica · Inspección de Taller', 'HTML_DINAMICO', FALSE, FALSE)
ON CONFLICT (codigo) DO UPDATE
SET nombre = EXCLUDED.nombre,
    motor = EXCLUDED.motor,
    activo = FALSE,
    actualizado_en = CURRENT_TIMESTAMP;

DO $migration$
DECLARE
    v_formato_id INTEGER;
    v_version INTEGER;
    v_html TEXT := $html$<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Certificado de Inspección de Taller</title>
  <style>
    @page { size: A4 portrait; margin: 0; }
    * { box-sizing: border-box; }
    body { margin: 0; padding: 0; background: #fff; color: #111; font-family: Arial, Helvetica, sans-serif; }
    .documento-certificado { width: 210mm; min-height: 297mm; margin: 0 auto; padding: 10mm 24mm 15mm; font-size: 10px; line-height: 1.35; }
    .cabecera-legal { width: 60mm; margin-bottom: 14mm; font-size: 8.5px; line-height: 1.25; text-align: center; }
    .titulo-principal { margin: 0 0 14mm; font-size: 14px; font-weight: 700; text-align: center; }
    .sub-header { display: flex; justify-content: space-between; gap: 12mm; margin-bottom: 14mm; font-size: 10.5px; }
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
  </style>
</head>
<body>
  <main class="documento-certificado">
    <header class="cabecera-legal">
      <div>R.D. N° <span data-faregas-var="empresa.resolucion" data-faregas-label="Resolución de Autorización" data-faregas-fallback="" data-faregas-source="FORM">{{empresa.resolucion}}</span></div>
      <div>Domicilio Fiscal: <span data-faregas-var="empresa.direccion" data-faregas-label="Dirección de la Empresa" data-faregas-fallback="" data-faregas-source="FORM">{{empresa.direccion}}</span></div>
      <div>Celular: <span data-faregas-var="empresa.telefono" data-faregas-label="Teléfono de la Empresa" data-faregas-fallback="" data-faregas-source="FORM">{{empresa.telefono}}</span></div>
    </header>

    <h1 class="titulo-principal"><span data-faregas-var="certificado.titulo" data-faregas-label="Título del Certificado" data-faregas-fallback="" data-faregas-source="FORM">{{certificado.titulo}}</span></h1>

    <section class="sub-header">
      <div>Tipo de Certificación: <strong><span data-faregas-var="certificado.modalidad" data-faregas-label="Modalidad" data-faregas-fallback="" data-faregas-source="FORM">{{certificado.modalidad}}</span></strong></div>
      <div>Certificado N° <strong><span data-faregas-var="certificado.numero" data-faregas-label="Número del Certificado" data-faregas-fallback="" data-faregas-source="FORM">{{certificado.numero}}</span></strong></div>
    </section>

    <p class="parrafo">La empresa <strong><span data-faregas-var="empresa.razon_social" data-faregas-label="Razón Social Empresa" data-faregas-fallback="" data-faregas-source="FORM">{{empresa.razon_social}}</span></strong>, autorizada como Entidad Certificadora de Conversión a <strong><span data-faregas-var="inspeccion.tipo_combustible" data-faregas-label="Sistema de combustible (GNV o GLP)" data-faregas-fallback="" data-faregas-source="FORM">{{inspeccion.tipo_combustible}}</span></strong>, con R.D. N° <span data-faregas-var="empresa.resolucion" data-faregas-label="Resolución de Autorización" data-faregas-fallback="" data-faregas-source="FORM">{{empresa.resolucion}}</span>.</p>
    <p class="certifica"><strong>CERTIFICA:</strong> Haber efectuado la inspección del siguiente taller:</p>

    <table class="tabla-info">
      <tbody>
        <tr><td>1</td><td>Nombre de taller</td><td><span data-faregas-var="taller.nombre" data-faregas-label="Nombre del Taller" data-faregas-fallback="" data-faregas-source="FORM">{{taller.nombre}}</span></td></tr>
        <tr><td>2</td><td>Dirección</td><td><span data-faregas-var="taller.direccion" data-faregas-label="Dirección" data-faregas-fallback="" data-faregas-source="FORM">{{taller.direccion}}</span></td></tr>
        <tr><td>3</td><td>Teléfono</td><td><span data-faregas-var="taller.telefono" data-faregas-label="Teléfono" data-faregas-fallback="" data-faregas-source="FORM">{{taller.telefono}}</span></td></tr>
        <tr><td>4</td><td>Ciudad</td><td><span data-faregas-var="taller.ciudad" data-faregas-label="Ciudad" data-faregas-fallback="" data-faregas-source="FORM">{{taller.ciudad}}</span></td></tr>
        <tr><td>5</td><td>Representante legal</td><td><span data-faregas-var="taller.representante_legal" data-faregas-label="Representante Legal" data-faregas-fallback="" data-faregas-source="FORM">{{taller.representante_legal}}</span></td></tr>
        <tr><td>6</td><td>N° de autorización</td><td><span data-faregas-var="taller.numero_autorizacion" data-faregas-label="N° de Autorización" data-faregas-fallback="" data-faregas-source="FORM">{{taller.numero_autorizacion}}</span></td></tr>
      </tbody>
    </table>

    <p class="parrafo">Habiéndose verificado que su infraestructura inmobiliaria, equipamiento y personal técnico cumple con los requisitos establecidos en las normas legales y técnicas peruanas vigentes en la materia, calificando dicho taller para realizar la conversión y/o reparación del sistema de combustión de los vehículos a <strong><span data-faregas-var="inspeccion.tipo_combustible" data-faregas-label="Sistema de combustible (GNV o GLP)" data-faregas-fallback="" data-faregas-source="FORM">{{inspeccion.tipo_combustible}}</span></strong>, tal como se evidencia en los documentos que se anexan a la presente.</p>

    <section class="seccion-final">
      <p><strong>OBSERVACIONES:</strong> <span data-faregas-var="inspeccion.observaciones" data-faregas-label="Observaciones" data-faregas-fallback="NINGUNA" data-faregas-source="FORM">{{inspeccion.observaciones}}</span></p>
      <p>Fecha de la próxima inspección anual: <strong><span data-faregas-var="inspeccion.fecha_proxima_inspeccion" data-faregas-label="Fecha Próxima Inspección" data-faregas-fallback="" data-faregas-source="FORM">{{inspeccion.fecha_proxima_inspeccion}}</span></strong></p>
      <p class="fecha-expedicion">Se expide el presente certificado en la ciudad de Lima, <span data-faregas-var="certificado.fecha_emision" data-faregas-label="Fecha de Emisión" data-faregas-fallback="" data-faregas-source="FORM">{{certificado.fecha_emision}}</span>.</p>
    </section>
  </main>
</body>
</html>$html$;
BEGIN
    SELECT id
      INTO v_formato_id
      FROM fg_certificado_formato
     WHERE codigo = 'TALLER_INSPECCION_BASE';

    IF NOT EXISTS (
        SELECT 1
          FROM fg_certificado_formato_version
         WHERE formato_id = v_formato_id
           AND estado = 'VIGENTE'
    ) THEN
        SELECT COALESCE(MAX(version), 0) + 1
          INTO v_version
          FROM fg_certificado_formato_version
         WHERE formato_id = v_formato_id;

        INSERT INTO fg_certificado_formato_version
            (formato_id, version, archivo_ruta, configuracion, estado, vigente_desde, motor)
        VALUES
            (
                v_formato_id,
                v_version,
                'HTML',
                jsonb_build_object(
                    'html', v_html,
                    'variables_personalizadas', '[]'::jsonb,
                    'variables_usadas', to_jsonb(ARRAY[
                        'empresa.resolucion',
                        'empresa.direccion',
                        'empresa.telefono',
                        'certificado.modalidad',
                        'certificado.numero',
                        'certificado.titulo',
                        'empresa.razon_social',
                        'inspeccion.tipo_combustible',
                        'taller.nombre',
                        'taller.direccion',
                        'taller.telefono',
                        'taller.ciudad',
                        'taller.representante_legal',
                        'taller.numero_autorizacion',
                        'inspeccion.observaciones',
                        'inspeccion.fecha_proxima_inspeccion',
                        'certificado.fecha_emision'
                    ]::TEXT[])
                ),
                'VIGENTE',
                CURRENT_TIMESTAMP,
                'HTML_DINAMICO'
            );
    END IF;
END
$migration$;

-- El validador de formatos conserva la familia oficial del certificado. Por
-- eso cada combinación flujo/combustible/modalidad tiene una variante hija de
-- la base protegida correspondiente, aunque todas compartan el mismo HTML.
DO $variants$
DECLARE
    v_base_config JSONB;
    v_parent_id INTEGER;
    v_formato_id INTEGER;
    v_version INTEGER;
    variante RECORD;
BEGIN
    SELECT version.configuracion
      INTO v_base_config
      FROM fg_certificado_formato base
      JOIN fg_certificado_formato_version version ON version.formato_id = base.id
     WHERE base.codigo = 'TALLER_INSPECCION_BASE'
       AND version.estado = 'VIGENTE'
     ORDER BY version.version DESC
     LIMIT 1;

    IF v_base_config IS NULL THEN
        RAISE EXCEPTION 'No existe una versión vigente de TALLER_INSPECCION_BASE';
    END IF;

    FOR variante IN
        SELECT *
          FROM (VALUES
              ('TALLER_GNV_INICIAL_FORMATO', 'Inspección de Taller GNV Inicial', 'GNV_INICIAL'),
              ('TALLER_GNV_ANUAL_FORMATO',   'Inspección de Taller GNV Anual',   'GNV_ANUAL'),
              ('TALLER_GLP_INICIAL_FORMATO', 'Inspección de Taller GLP Inicial', 'GLP_INICIAL'),
              ('TALLER_GLP_ANUAL_FORMATO',   'Inspección de Taller GLP Anual',   'GLP_ANUAL')
          ) AS formatos(codigo, nombre, padre_codigo)
    LOOP
        SELECT id
          INTO v_parent_id
          FROM fg_certificado_formato
         WHERE codigo = variante.padre_codigo
           AND es_protegido = TRUE;

        IF v_parent_id IS NULL THEN
            RAISE EXCEPTION 'No existe la base protegida %', variante.padre_codigo;
        END IF;

        INSERT INTO fg_certificado_formato
            (codigo, nombre, motor, es_protegido, activo, formato_padre_id)
        VALUES
            (variante.codigo, variante.nombre, 'HTML_DINAMICO', FALSE, TRUE, v_parent_id)
        ON CONFLICT (codigo) DO UPDATE
        SET nombre = EXCLUDED.nombre,
            motor = EXCLUDED.motor,
            activo = TRUE,
            formato_padre_id = EXCLUDED.formato_padre_id,
            actualizado_en = CURRENT_TIMESTAMP;

        SELECT id
          INTO v_formato_id
          FROM fg_certificado_formato
         WHERE codigo = variante.codigo;

        IF NOT EXISTS (
            SELECT 1
              FROM fg_certificado_formato_version
             WHERE formato_id = v_formato_id
               AND estado = 'VIGENTE'
        ) THEN
            SELECT COALESCE(MAX(version), 0) + 1
              INTO v_version
              FROM fg_certificado_formato_version
             WHERE formato_id = v_formato_id;

            INSERT INTO fg_certificado_formato_version
                (formato_id, version, archivo_ruta, configuracion, estado, vigente_desde, motor)
            VALUES
                (v_formato_id, v_version, 'HTML', v_base_config, 'VIGENTE', CURRENT_TIMESTAMP, 'HTML_DINAMICO');
        END IF;
    END LOOP;
END
$variants$;

COMMIT;
