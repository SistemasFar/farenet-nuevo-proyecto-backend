const ESTILOS_DOCUMENTO_A4 = `
  @page { size: A4 portrait; margin: 0; }
  body { margin: 0; padding: 0; background: #fff; color: #000; font-family: Arial, Helvetica, sans-serif; }
  .documento-certificado { box-sizing: border-box; width: 210mm; min-height: 297mm; margin: 0 auto; padding: 20mm 15mm 15mm; }
  .cabecera-legal { margin-bottom: 40px; font-size: 11px; line-height: 1.2; text-align: left; }
  .titulo-principal { margin-bottom: 30px; font-size: 16px; font-weight: bold; text-align: center; }
  .sub-header { display: flex; justify-content: space-between; margin-bottom: 25px; font-size: 12px; }
  .parrafo-certifica { margin-bottom: 15px; font-size: 12px; line-height: 1.4; text-align: justify; }
  .tabla-info { width: 100%; margin-bottom: 20px; border-collapse: collapse; table-layout: fixed; font-size: 12px; }
  .tabla-info td { border: 1px solid #000; padding: 6px 8px; }
  .tabla-info td:nth-child(1) { width: 5%; text-align: center; }
  .tabla-info td:nth-child(2) { width: 35%; }
  .tabla-info td:nth-child(3) { width: 60%; }
  .seccion-final { margin-top: 15px; font-size: 12px; line-height: 1.5; }
  .contenido-word table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  .contenido-word td, .contenido-word th { border: 1px solid #000; padding: 5px; vertical-align: top; }
  .contenido-word img { max-width: 100%; height: auto; }
`;

// Medidas obtenidas de los Word oficiales de inspección anual de taller
// GLP/GNV. Se aplica al final de la cascada únicamente a formatos TALLER_*.
const ESTILOS_TALLER_OFICIAL = `
  @page { size: Letter portrait; margin: 0; }
  html, body { width: 612pt; min-height: 792pt; margin: 0; background: #fff; }
  body.faregas-taller-word { color: #000; font-family: Calibri, Arial, sans-serif; }
  .faregas-taller-word .documento-certificado {
    position: relative; box-sizing: border-box; width: 612pt; min-height: 792pt;
    margin: 0; padding: 164.25pt 85.05pt 70.85pt 84.75pt;
    color: #000; font-family: Calibri, Arial, sans-serif; font-size: 11pt; line-height: 12pt;
  }
  .faregas-taller-word .cabecera-legal {
    position: absolute; top: 61pt; left: 34pt; width: 190pt; margin: 0;
    color: #000; font: 8.5pt/10.2pt Arial, sans-serif; text-align: center;
  }
  .faregas-taller-word .titulo-principal {
    margin: 0 0 32.05pt; color: #000; font: 700 11pt/12.95pt Arial, sans-serif;
    text-align: center;
  }
  .faregas-taller-word .sub-header {
    display: flex; justify-content: space-between; align-items: baseline; gap: 20pt;
    margin: 0 0 32.05pt; font: 11pt/12.95pt Calibri, Arial, sans-serif;
  }
  .faregas-taller-word .sub-header > :last-child { margin-left: auto; text-align: right; }
  .faregas-taller-word .parrafo,
  .faregas-taller-word .parrafo-certifica { margin: 0; font: 11pt/12pt Calibri, Arial, sans-serif; }
  .faregas-taller-word .institucional { margin-bottom: 16.5pt; text-align: left; }
  .faregas-taller-word .certifica { margin: 0 0 15.75pt; font: 11pt/12pt Calibri, Arial, sans-serif; }
  .faregas-taller-word .tabla-info {
    width: 432.1pt; margin: 0 0 24.75pt 6pt; border-collapse: collapse;
    table-layout: fixed; font: 11pt/12pt Calibri, Arial, sans-serif;
  }
  .faregas-taller-word .tabla-info col:nth-child(1),
  .faregas-taller-word .tabla-info td:nth-child(1) { width: 21.05pt !important; text-align: center; }
  .faregas-taller-word .tabla-info col:nth-child(2),
  .faregas-taller-word .tabla-info td:nth-child(2) { width: 106.3pt !important; }
  .faregas-taller-word .tabla-info col:nth-child(3),
  .faregas-taller-word .tabla-info td:nth-child(3) { width: 304.75pt !important; }
  .faregas-taller-word .tabla-info td {
    box-sizing: border-box; min-height: 14.25pt; border: .5pt solid #000;
    padding: .7pt 5.4pt; vertical-align: middle; overflow-wrap: break-word;
  }
  .faregas-taller-word .tabla-info p { margin: 0; }
  .faregas-taller-word .verificacion {
    margin: 0 0 29.25pt; font: 11pt/12pt Calibri, Arial, sans-serif; text-align: justify;
  }
  .faregas-taller-word .seccion-final { margin: 0; font-family: Calibri, Arial, sans-serif; }
  .faregas-taller-word .seccion-final p { margin: 0; }
  .faregas-taller-word .proxima-inspeccion { font: 12pt/12.95pt Calibri, Arial, sans-serif; }
  .faregas-taller-word.taller-glp .proxima-inspeccion { margin-bottom: 57.55pt; }
  .faregas-taller-word.taller-gnv .proxima-inspeccion { margin-bottom: 33.55pt; }
  .faregas-taller-word .seccion-final p.observaciones { margin: 0 0 24.75pt; font: 700 11pt/12pt Calibri, Arial, sans-serif; text-align: left; }
  .faregas-taller-word .fecha-expedicion { margin: 0; font: 12pt/12.95pt Calibri, Arial, sans-serif; }
`;

const PLANTILLA_FAREGAS_HTML = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Certificado FAREGAS</title>
  <style>${ESTILOS_DOCUMENTO_A4}${ESTILOS_TALLER_OFICIAL}</style>
</head>
<body>
  <div class="documento-certificado">
    <div class="cabecera-legal">
      <div>R.D. N° <span data-faregas-var="empresa.resolucion" data-faregas-label="Resolución de Autorización" data-faregas-fallback="" data-faregas-source="FORM">{{empresa.resolucion}}</span></div>
      <div>Domicilio Fiscal: <span data-faregas-var="empresa.direccion" data-faregas-label="Dirección de la Empresa" data-faregas-fallback="" data-faregas-source="FORM">{{empresa.direccion}}</span></div>
      <div>Celular: <span data-faregas-var="empresa.telefono" data-faregas-label="Teléfono de la Empresa" data-faregas-fallback="" data-faregas-source="FORM">{{empresa.telefono}}</span></div>
    </div>

    <div class="titulo-principal"><span data-faregas-var="certificado.titulo" data-faregas-label="Título del Certificado" data-faregas-fallback="" data-faregas-source="FORM">{{certificado.titulo}}</span></div>

    <div class="sub-header">
      <div>Tipo de Certificación: <span data-faregas-var="certificado.modalidad" data-faregas-label="Modalidad" data-faregas-fallback="" data-faregas-source="FORM">{{certificado.modalidad}}</span></div>
      <div>Certificado N° <span data-faregas-var="certificado.numero" data-faregas-label="Número del Certificado" data-faregas-fallback="" data-faregas-source="FORM">{{certificado.numero}}</span></div>
    </div>

    <div class="parrafo-certifica institucional">La empresa <span data-faregas-var="empresa.razon_social" data-faregas-label="Razón Social Empresa" data-faregas-fallback="" data-faregas-source="FORM">{{empresa.razon_social}}</span>, reconocida como Entidad Certificadora de <span data-faregas-var="inspeccion.tipo_combustible" data-faregas-label="Sistema de combustible (GNV o GLP)" data-faregas-fallback="" data-faregas-source="FORM">{{inspeccion.tipo_combustible}}</span> con R.D. N° <span data-faregas-var="empresa.resolucion" data-faregas-label="Resolución de Autorización" data-faregas-fallback="" data-faregas-source="FORM">{{empresa.resolucion}}</span>.</div>
    <div class="parrafo-certifica certifica"><strong>CERTIFICA:</strong> Haber efectuado la inspección del siguiente taller:</div>

    <table class="tabla-info"><colgroup><col><col><col></colgroup><tbody>
      <tr><td>1</td><td>Nombre de taller</td><td><span data-faregas-var="taller.nombre" data-faregas-label="Nombre del Taller" data-faregas-fallback="" data-faregas-source="FORM">{{taller.nombre}}</span></td></tr>
      <tr><td>2</td><td>Dirección</td><td><span data-faregas-var="taller.direccion" data-faregas-label="Dirección" data-faregas-fallback="" data-faregas-source="FORM">{{taller.direccion}}</span></td></tr>
      <tr><td>3</td><td>Teléfono</td><td><span data-faregas-var="taller.telefono" data-faregas-label="Teléfono" data-faregas-fallback="" data-faregas-source="FORM">{{taller.telefono}}</span></td></tr>
      <tr><td>4</td><td>Ciudad</td><td><span data-faregas-var="taller.ciudad" data-faregas-label="Ciudad" data-faregas-fallback="" data-faregas-source="FORM">{{taller.ciudad}}</span></td></tr>
      <tr><td>5</td><td>Representante legal</td><td><span data-faregas-var="taller.representante_legal" data-faregas-label="Representante Legal" data-faregas-fallback="" data-faregas-source="FORM">{{taller.representante_legal}}</span></td></tr>
      <tr><td>6</td><td>N° de autorización</td><td><span data-faregas-var="taller.numero_autorizacion" data-faregas-label="N° de Autorización" data-faregas-fallback="" data-faregas-source="FORM">{{taller.numero_autorizacion}}</span></td></tr>
    </tbody></table>

    <div class="parrafo-certifica verificacion">Habiéndose verificado que su infraestructura inmobiliaria, equipamiento y personal técnico cumple con los requisitos establecidos en las normas legales y técnicas peruanas vigentes en la materia, calificando dicho taller para realizar la conversión y/o reparación del sistema de combustión de los vehículos a <span data-faregas-var="inspeccion.tipo_combustible" data-faregas-label="Sistema de combustible (GNV o GLP)" data-faregas-fallback="" data-faregas-source="FORM">{{inspeccion.tipo_combustible}}</span>, tal como se evidencia en los documentos anexos.</div>

    <div class="seccion-final">
      <p class="proxima-inspeccion">Fecha de la próxima inspección anual: <strong><span data-faregas-var="inspeccion.fecha_proxima_inspeccion" data-faregas-label="Fecha Próxima Inspección" data-faregas-fallback="" data-faregas-source="FORM">{{inspeccion.fecha_proxima_inspeccion}}</span></strong>.</p>
      <p class="observaciones"><strong>OBSERVACIONES:</strong> <span data-faregas-var="inspeccion.observaciones" data-faregas-label="Observaciones" data-faregas-fallback="NINGUNA" data-faregas-source="FORM">{{inspeccion.observaciones}}</span></p>
      <p class="fecha-expedicion">Se expide el presente certificado en la ciudad de Lima, <span data-faregas-var="certificado.fecha_emision" data-faregas-label="Fecha de Emisión" data-faregas-fallback="" data-faregas-source="FORM">{{certificado.fecha_emision}}</span>.</p>
    </div>
  </div>
</body>
</html>`;

const crearDocumentoHtmlImportado = (contenidoHtml, titulo = 'Documento importado') => `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>${String(titulo).replace(/[<>&"']/g, '')}</title>
  <style>${ESTILOS_DOCUMENTO_A4}</style>
</head>
<body><div class="documento-certificado"><div class="contenido-word">${contenidoHtml}</div></div></body>
</html>`;

module.exports = {
  ESTILOS_DOCUMENTO_A4,
  ESTILOS_TALLER_OFICIAL,
  PLANTILLA_FAREGAS_HTML,
  crearDocumentoHtmlImportado
};
