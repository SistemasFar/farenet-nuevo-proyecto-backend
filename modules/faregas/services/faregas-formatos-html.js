const cheerio = require('cheerio');
const { ESTILOS_TALLER_OFICIAL } = require('./faregas-formatos.templates');

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

    // Corrección para plantillas de Taller donde la fecha de expedición quedó mapeada a documento.fecha_dia
    $('span[data-faregas-var="documento.fecha_dia"]').each((_index, element) => {
        const slot = $(element);
        const parentText = slot.parent().text() || '';
        if (parentText.includes('Se expide el presente certificado')) {
            slot.attr('data-faregas-var', 'certificado.fecha_emision');
            slot.attr('data-faregas-label', 'Fecha de Emisión');
        }
    });

    // Asegurar punto final en la fecha de expedición si no lo tuviera
    $('span[data-faregas-var="certificado.fecha_emision"]').each((_index, element) => {
        const slot = $(element);
        const parentText = slot.parent().text() || '';
        if (parentText.includes('Se expide el presente certificado')) {
            const nextNode = slot[0]?.nextSibling;
            const nextText = (nextNode && nextNode.nodeValue) ? nextNode.nodeValue : '';
            if (!nextText.trim().startsWith('.')) {
                if (!slot.text().trim().endsWith('.')) {
                    slot.after('.');
                }
            }
        }
    });

    // Asegurar punto final en fecha de próxima inspección anual
    $('span[data-faregas-var="inspeccion.fecha_proxima_inspeccion"]').each((_index, element) => {
        const slot = $(element);
        const parent = slot.parent();
        const nextNode = parent[0]?.nextSibling;
        const nextText = (nextNode && nextNode.nodeValue) ? nextNode.nodeValue : '';
        if (!nextText.trim().startsWith('.')) {
            if (!slot.text().trim().endsWith('.')) {
                parent.after('.');
            }
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

/**
 * Adapta cualquier versión HTML_DINAMICO de Taller a la geometría de los
 * documentos Word oficiales. No sustituye valores ni persiste cambios: sólo
 * normaliza clases, orden visual y CSS al momento de renderizar.
 */
const aplicarLayoutOficialTaller = (html = '', data = {}) => {
    const $ = cheerio.load(String(html), { decodeEntities: false });
    const combustible = String(data?.inspeccion?.tipo_combustible || '').toUpperCase();
    const esGlp = combustible.includes('GLP') || combustible.includes('LICUADO');
    const body = $('body').first();
    body.addClass(`faregas-taller-word ${esGlp ? 'taller-glp' : 'taller-gnv'}`);

    const documento = $('.documento-certificado').first();
    const parrafos = documento.find('.parrafo, .parrafo-certifica');
    parrafos.each((_index, element) => {
        const nodo = $(element);
        const texto = nodo.text().replace(/\s+/g, ' ').trim().toUpperCase();
        if (texto.startsWith('LA EMPRESA ')) nodo.addClass('institucional');
        if (texto.startsWith('CERTIFICA')) nodo.addClass('certifica');
        if (texto.startsWith('HABIÉNDOSE VERIFICADO') || texto.startsWith('HABIENDOSE VERIFICADO')) {
            nodo.addClass('verificacion');
        }
    });

    const seccionFinal = documento.find('.seccion-final').first();
    const proxima = documento.find('[data-faregas-var="inspeccion.fecha_proxima_inspeccion"]').first().closest('p, div');
    const observaciones = documento.find('[data-faregas-var="inspeccion.observaciones"]').first().closest('p, div');
    const expedicion = documento.find('[data-faregas-var="certificado.fecha_emision"]').filter((_index, element) => (
        $(element).parent().text().includes('Se expide el presente certificado')
    )).first().closest('p, div');

    proxima.addClass('proxima-inspeccion');
    observaciones.addClass('observaciones');
    expedicion.addClass('fecha-expedicion');
    if (seccionFinal.length) {
        if (proxima.length) seccionFinal.append(proxima);
        if (observaciones.length) seccionFinal.append(observaciones);
        if (expedicion.length) seccionFinal.append(expedicion);
    }

    $('style#faregas-taller-word-oficial').remove();
    $('head').append(`<style id="faregas-taller-word-oficial">${ESTILOS_TALLER_OFICIAL}</style>`);
    return $.html();
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
    aplicarLayoutOficialTaller,
    variablesDesconocidas
};
