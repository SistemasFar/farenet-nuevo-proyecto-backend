const cheerio = require('cheerio');

const CANONICAL_ATTRIBUTE = 'data-faregas-var';
const FALLBACK_ATTRIBUTE = 'data-faregas-fallback';
const LEGACY_ATTRIBUTE = 'data-faregas-slot';
const ELEMENTOS_EJECUTABLES = 'script, iframe, object, embed, applet, form, input, button, textarea, select';
const ATRIBUTOS_URL = new Set(['href', 'src', 'xlink:href', 'formaction']);
const URL_SEGURA = /^(?:https?:|data:image\/(?:png|jpeg|jpg|webp);base64,|\/|\.\/|\.\.\/|#)/i;

const limpiarCss = (css = '') => String(css)
    .replace(/@import[^;]+;?/gi, '')
    .replace(/expression\s*\([^)]*\)/gi, '')
    .replace(/url\s*\(\s*(['"]?)\s*javascript:[^)]+\)/gi, '');

const sanitizarHtmlDocumental = (html = '') => {
    const $ = cheerio.load(String(html), { decodeEntities: false });
    $(ELEMENTOS_EJECUTABLES).remove();
    $('meta[http-equiv="refresh"], link[rel="import"]').remove();

    $('*').each((_index, element) => {
        const nodo = $(element);
        Object.entries(element.attribs || {}).forEach(([nombre, valor]) => {
            const clave = nombre.toLowerCase();
            const contenido = String(valor || '').trim();
            if (clave.startsWith('on') || clave === 'srcdoc' || clave === 'contenteditable' || clave === 'draggable' || clave.startsWith('data-pm-')) {
                nodo.removeAttr(nombre);
            } else if (ATRIBUTOS_URL.has(clave) && contenido && !URL_SEGURA.test(contenido)) {
                nodo.removeAttr(nombre);
            } else if (clave === 'style') {
                nodo.attr(nombre, limpiarCss(contenido));
            }
        });
    });
    $('style').each((_index, element) => { $(element).text(limpiarCss($(element).text())); });
    return $.html();
};

const valorAnidado = (data, key) => key
    .split('.')
    .reduce((actual, parte) => (actual == null ? undefined : actual[parte]), data);

const normalizarHtmlEditor = (html = '') => {
    const $ = cheerio.load(sanitizarHtmlDocumental(html), { decodeEntities: false });

    $(`[${LEGACY_ATTRIBUTE}]`).each((_index, element) => {
        const slot = $(element);
        const key = String(slot.attr(LEGACY_ATTRIBUTE) || '').trim();
        if (key && !slot.attr(CANONICAL_ATTRIBUTE)) slot.attr(CANONICAL_ATTRIBUTE, key);
        slot.removeAttr(LEGACY_ATTRIBUTE);
    });

    $(`[${CANONICAL_ATTRIBUTE}]`).each((_index, element) => {
        const slot = $(element);
        const key = String(slot.attr(CANONICAL_ATTRIBUTE) || '').trim();
        slot.attr(CANONICAL_ATTRIBUTE, key);
        if (slot.attr(FALLBACK_ATTRIBUTE) === undefined) {
            const texto = slot.text().trim();
            slot.attr(FALLBACK_ATTRIBUTE, texto === `{{${key}}}` ? '' : texto);
        }
    });

    return $.html();
};

const extraerVariablesHtml = (html = '') => {
    const normalizado = normalizarHtmlEditor(html);
    const $ = cheerio.load(normalizado, { decodeEntities: false });
    const variables = new Set();

    $(`[${CANONICAL_ATTRIBUTE}]`).each((_index, element) => {
        const key = String($(element).attr(CANONICAL_ATTRIBUTE) || '').trim();
        if (key) variables.add(key);
    });

    const regex = /\{\{\s*([^{}]+?)\s*\}\}/g;
    let match;
    while ((match = regex.exec(normalizado)) !== null) variables.add(match[1].trim());
    return [...variables];
};

const renderizarHtml = (html = '', data = {}) => {
    const normalizado = normalizarHtmlEditor(html);
    const $ = cheerio.load(normalizado, { decodeEntities: false });

    $(`[${CANONICAL_ATTRIBUTE}]`).each((_index, element) => {
        const slot = $(element);
        const key = String(slot.attr(CANONICAL_ATTRIBUTE) || '').trim();
        const valor = valorAnidado(data, key);
        const fallback = slot.attr(FALLBACK_ATTRIBUTE) || '';
        slot.text(valor == null || valor === '' ? fallback : String(valor));
        slot.removeAttr(FALLBACK_ATTRIBUTE);
    });

    return $.html().replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (placeholder, key) => {
        const valor = valorAnidado(data, key.trim());
        return valor == null ? placeholder : String(valor);
    });
};

const variablesDesconocidas = (html, variablesPermitidas) => {
    const permitidas = new Set(variablesPermitidas);
    return extraerVariablesHtml(html).filter((key) => !permitidas.has(key));
};

module.exports = {
    CANONICAL_ATTRIBUTE,
    FALLBACK_ATTRIBUTE,
    LEGACY_ATTRIBUTE,
    sanitizarHtmlDocumental,
    normalizarHtmlEditor,
    extraerVariablesHtml,
    renderizarHtml,
    variablesDesconocidas
};
