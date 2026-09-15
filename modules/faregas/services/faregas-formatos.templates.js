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

const PLANTILLA_FAREGAS_HTML = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Certificado FAREGAS</title>
  <style>${ESTILOS_DOCUMENTO_A4}</style>
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

    <div class="parrafo-certifica">La empresa <span data-faregas-var="empresa.razon_social" data-faregas-label="Razón Social Empresa" data-faregas-fallback="" data-faregas-source="FORM">{{empresa.razon_social}}</span> autorizada como Entidad Certificadora de Conversión a Gas Natural Vehicular con R.D. N° <span data-faregas-var="empresa.resolucion" data-faregas-label="Resolución de Autorización" data-faregas-fallback="" data-faregas-source="FORM">{{empresa.resolucion}}</span>.</div>
    <div class="parrafo-certifica"><strong>CERTIFICA:</strong> Haber efectuado la inspección del siguiente taller:</div>

    <table class="tabla-info"><tbody>
      <tr><td>1</td><td>Nombre de taller</td><td><span data-faregas-var="taller.nombre" data-faregas-label="Nombre del Taller" data-faregas-fallback="" data-faregas-source="FORM">{{taller.nombre}}</span></td></tr>
      <tr><td>2</td><td>Dirección</td><td><span data-faregas-var="taller.direccion" data-faregas-label="Dirección" data-faregas-fallback="" data-faregas-source="FORM">{{taller.direccion}}</span></td></tr>
      <tr><td>3</td><td>Teléfono</td><td><span data-faregas-var="taller.telefono" data-faregas-label="Teléfono" data-faregas-fallback="" data-faregas-source="FORM">{{taller.telefono}}</span></td></tr>
      <tr><td>4</td><td>Ciudad</td><td><span data-faregas-var="taller.ciudad" data-faregas-label="Ciudad" data-faregas-fallback="" data-faregas-source="FORM">{{taller.ciudad}}</span></td></tr>
      <tr><td>5</td><td>Representante legal</td><td><span data-faregas-var="taller.representante_legal" data-faregas-label="Representante Legal" data-faregas-fallback="" data-faregas-source="FORM">{{taller.representante_legal}}</span></td></tr>
      <tr><td>6</td><td>N° de autorización</td><td><span data-faregas-var="taller.numero_autorizacion" data-faregas-label="N° de Autorización" data-faregas-fallback="" data-faregas-source="FORM">{{taller.numero_autorizacion}}</span></td></tr>
    </tbody></table>

    <div class="parrafo-certifica">Habiéndose verificado que su infraestructura inmobiliaria, equipamiento y personal técnico cumple con los requisitos establecidos en las normas legales y técnicas peruanas vigentes en la materia, calificando dicho taller para realizar la conversión y/o reparación del sistema de combustión de los vehículos a Gas Natural Vehicular – GNV, tal como se evidencia en los documentos anexos.</div>

    <div class="seccion-final">
      <strong>OBSERVACIONES:</strong> <span data-faregas-var="inspeccion.observaciones" data-faregas-label="Observaciones" data-faregas-fallback="" data-faregas-source="FORM">{{inspeccion.observaciones}}</span><br><br>
      Fecha de la próxima inspección anual: <strong><span data-faregas-var="inspeccion.fecha_proxima_inspeccion" data-faregas-label="Fecha Próxima Inspección" data-faregas-fallback="" data-faregas-source="FORM">{{inspeccion.fecha_proxima_inspeccion}}</span></strong>.<br><br>
      Se expide el presente certificado en la ciudad de Lima, <span data-faregas-var="certificado.fecha_emision" data-faregas-label="Fecha de Emisión" data-faregas-fallback="" data-faregas-source="FORM">{{certificado.fecha_emision}}</span>
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
  PLANTILLA_FAREGAS_HTML,
  crearDocumentoHtmlImportado
};
