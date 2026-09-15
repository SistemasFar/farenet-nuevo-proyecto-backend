const mammoth = require('mammoth');
const { normalizarHtmlEditor } = require('./faregas-formatos-html');
const { crearDocumentoHtmlImportado } = require('./faregas-formatos.templates');

const convertirDocxAHtml = async (buffer, nombreArchivo = 'Documento Word') => {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new Error('El archivo Word está vacío');

  const resultado = await mammoth.convertToHtml(
    { buffer },
    {
      styleMap: [
        "p[style-name='Title'] => h1:fresh",
        "p[style-name='Heading 1'] => h2:fresh",
        "p[style-name='Heading 2'] => h3:fresh"
      ]
    }
  );
  const imagenes = (resultado.value.match(/<img\b[^>]*>/gi) || []).length;
  const contenidoSinImagenes = resultado.value.replace(
    /<img\b[^>]*>/gi,
    '<p class="imagen-word-omitida">[Imagen del Word pendiente de agregar]</p>'
  );
  const advertencias = resultado.messages.map((mensaje) => String(mensaje.message || mensaje));
  if (imagenes > 0) advertencias.push(`${imagenes} imagen(es) no se incrustaron; deben agregarse desde la futura galería documental.`);

  const titulo = String(nombreArchivo).replace(/\.docx$/i, '') || 'Documento importado';
  return {
    html: normalizarHtmlEditor(crearDocumentoHtmlImportado(contenidoSinImagenes, titulo)),
    advertencias
  };
};

module.exports = { convertirDocxAHtml };
