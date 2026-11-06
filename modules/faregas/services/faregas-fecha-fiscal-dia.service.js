'use strict';

const PERU_TIME_ZONE = 'America/Lima';

const obtenerFechaActualLima = (now = new Date()) => {
    const partes = new Intl.DateTimeFormat('en-CA', {
        timeZone: PERU_TIME_ZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(now);
    const valor = Object.fromEntries(partes.map(({ type, value }) => [type, value]));
    return { year: Number(valor.year), month: Number(valor.month), day: Number(valor.day) };
};

// pg devuelve una columna DATE como YYYY-MM-DD. No se aceptan timestamps ni
// fechas alternativas para evitar inferir el día fiscal desde UTC u otro campo.
const parsearFechaDocumentoFiscal = (value) => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) return null;
    return { year, month, day };
};

const compararFechasCalendario = (left, right) =>
    left.year - right.year || left.month - right.month || left.day - right.day;

const esDocumentoFiscalDeHoy = (fechaDocumento, now = new Date()) => {
    const fiscal = parsearFechaDocumentoFiscal(fechaDocumento);
    return Boolean(fiscal && compararFechasCalendario(fiscal, obtenerFechaActualLima(now)) === 0);
};

const exigirVentanaDiaFiscal = (fechaDocumento, accion, now = new Date()) => {
    const fiscal = parsearFechaDocumentoFiscal(fechaDocumento);
    if (!fiscal) {
        const error = new Error('FECHA_EMISION_FISCAL_NO_DISPONIBLE');
        error.code = 'FECHA_EMISION_FISCAL_NO_DISPONIBLE';
        error.statusCode = 409;
        throw error;
    }
    const comparacion = compararFechasCalendario(fiscal, obtenerFechaActualLima(now));
    const permitida = accion === 'ANULAR' ? comparacion === 0 : comparacion < 0;
    if (!permitida) {
        const error = new Error(accion === 'ANULAR' ? 'ANULACION_SOLO_DIA_EMISION' : 'NOTA_CREDITO_SOLO_DIA_POSTERIOR');
        error.code = error.message;
        error.statusCode = 409;
        throw error;
    }
};

module.exports = {
    PERU_TIME_ZONE,
    obtenerFechaActualLima,
    parsearFechaDocumentoFiscal,
    esDocumentoFiscalDeHoy,
    exigirVentanaDiaFiscal
};
