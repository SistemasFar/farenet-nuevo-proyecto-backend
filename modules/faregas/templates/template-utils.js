const NUMERO_CERTIFICADO_PENDIENTE = 'PENDIENTE DE EMISIÓN';

function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function formatDateLong(dateInput) {
    if (!dateInput) {
        const now = new Date();
        const diaNum = now.getDate();
        const dia = diaNum < 10 ? `0${diaNum}` : `${diaNum}`;
        const meses = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Setiembre', 'Octubre', 'Noviembre', 'Diciembre'];
        const mes = meses[now.getMonth()];
        const anio = now.getFullYear();
        return { dia, mes, anio };
    }
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) {
        return { dia: '___', mes: '___________', anio: '______' };
    }
    const diaNum = d.getUTCDate();
    const dia = diaNum < 10 ? `0${diaNum}` : `${diaNum}`;
    const meses = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Setiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    const mes = meses[d.getUTCMonth()];
    const anio = d.getUTCFullYear();
    return { dia, mes, anio };
}

function formatDateShort(dateInput) {
    if (!dateInput) return 'PREVISUALIZACIÓN';
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return 'PREVISUALIZACIÓN';
    const dia = String(d.getUTCDate()).padStart(2, '0');
    const mes = String(d.getUTCMonth() + 1).padStart(2, '0');
    const anio = d.getUTCFullYear();
    return `${dia}/${mes}/${anio}`;
}

/**
 * PostgreSQL devuelve columnas NUMERIC como texto con su escala declarada
 * (por ejemplo, "1301.000"). Para impresión conserva el valor y elimina
 * únicamente los ceros decimales que no aportan información.
 */
function formatNumberWithoutTrailingZeros(value, fallback = '-') {
    if (value === null || value === undefined || String(value).trim() === '') return fallback;
    const original = String(value).trim();
    const normalized = original.replace(',', '.');
    if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) return original;
    return normalized.includes('.')
        ? normalized.replace(/0+$/, '').replace(/\.$/, '')
        : normalized;
}

/**
 * Elimina ceros finales únicamente de los segmentos decimales contenidos en
 * una expresión técnica. Conserva literalmente separadores como @, / y -.
 * Ejemplo: "41.00@5500" -> "41@5500".
 */
function formatTechnicalNumberExpression(value, fallback = '-') {
    if (value === null || value === undefined || String(value).trim() === '') return fallback;
    return String(value).trim().replace(/-?\d+[.,]\d+/g, (segmento) => (
        formatNumberWithoutTrailingZeros(segmento, segmento)
    ));
}

function formatNumeroCertificado(value, fallback = '') {
    return formatNumberWithoutTrailingZeros(value, fallback);
}

/** Presenta conteos técnicos con la nomenclatura de dos dígitos del certificado. */
function formatCountTwoDigits(value, fallback = '-') {
    const integer = formatNumberWithoutTrailingZeros(value, '');
    if (!integer) return fallback;
    return /^\d+$/.test(integer) ? integer.padStart(2, '0') : integer;
}

module.exports = {
    NUMERO_CERTIFICADO_PENDIENTE,
    escapeHtml,
    formatDateLong,
    formatDateShort,
    formatNumberWithoutTrailingZeros,
    formatTechnicalNumberExpression,
    formatNumeroCertificado,
    formatCountTwoDigits
};
