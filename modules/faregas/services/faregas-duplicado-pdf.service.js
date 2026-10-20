const MARCA_DUPLICADO = 'DUPLICADO';

const agregarMarcaDuplicado = (html) => {
    const contenido = String(html || '');
    if (!contenido.trim()) {
        const error = new Error('CERTIFICADO_SIN_CONTENIDO');
        error.statusCode = 409;
        throw error;
    }
    if (contenido.includes('data-faregas-duplicado="true"')) return contenido;

    const marca = `
<div data-faregas-duplicado="true" style="position:fixed;left:50%;top:50%;transform:translate(-50%,-50%) rotate(-35deg);z-index:2147483647;font-family:Arial,sans-serif;font-size:110px;font-weight:900;letter-spacing:8px;color:rgba(185,28,28,.13);white-space:nowrap;pointer-events:none;user-select:none;">${MARCA_DUPLICADO}</div>`;
    return /<body\b[^>]*>/i.test(contenido)
        ? contenido.replace(/<body\b[^>]*>/i, (body) => `${body}${marca}`)
        : `${marca}${contenido}`;
};

module.exports = { MARCA_DUPLICADO, agregarMarcaDuplicado };
