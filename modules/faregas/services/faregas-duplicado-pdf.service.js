/**
 * El duplicado usa exactamente el HTML original almacenado. No se agrega
 * ninguna marca, sello ni superposición al documento generado.
 */
const prepararHtmlDuplicado = (html) => {
    const contenido = String(html || '');
    if (!contenido.trim()) {
        const error = new Error('CERTIFICADO_SIN_CONTENIDO');
        error.statusCode = 409;
        throw error;
    }
    return contenido;
};

module.exports = { prepararHtmlDuplicado };
