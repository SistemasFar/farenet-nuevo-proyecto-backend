const CODIGO_AUTORIZACION_GRATUIDAD_TALLER = 'DESCUENTO_TALLER';
const TIPO_FLUJO_TALLER = 'TALLER_INSPECCION';

const normalizarCodigo = (value) => String(value || '').trim().toUpperCase();

const esCodigoGratuidadTaller = (value) => (
    normalizarCodigo(value) === CODIGO_AUTORIZACION_GRATUIDAD_TALLER
);

const esFlujoTaller = (value) => normalizarCodigo(value) === TIPO_FLUJO_TALLER;

const obtenerCodigoAutorizacion = (reserva = {}) => (
    reserva.codigo_autorizacion
    || reserva.codigoAutorizacion
    || reserva.codigo
    || ''
);

const esGratuidadTallerAutorizada = ({ reserva = {}, tipoFlujo = '' } = {}) => (
    esCodigoGratuidadTaller(obtenerCodigoAutorizacion(reserva))
    && esFlujoTaller(tipoFlujo)
);

const consultarConvenioProtegido = async (queryable, descuentoId, bloquear = false) => {
    const resultado = await queryable.query(`
        SELECT d.id, d.codigo, d.nombre, dc.id AS codigo_id, dc.codigo AS codigo_autorizacion
        FROM fg_descuento d
        JOIN fg_descuentocliente dc ON dc.descuento_id = d.id
        WHERE d.id = $1
          AND UPPER(BTRIM(dc.codigo)) = $2
        LIMIT 1
        ${bloquear ? 'FOR UPDATE OF d, dc' : ''}
    `, [descuentoId, CODIGO_AUTORIZACION_GRATUIDAD_TALLER]);
    return resultado.rows[0] || null;
};

const consultarCodigoProtegido = async (queryable, codigoId, bloquear = false) => {
    const resultado = await queryable.query(`
        SELECT dc.id, dc.descuento_id, dc.codigo
        FROM fg_descuentocliente dc
        WHERE dc.id = $1
          AND UPPER(BTRIM(dc.codigo)) = $2
        ${bloquear ? 'FOR UPDATE OF dc' : ''}
    `, [codigoId, CODIGO_AUTORIZACION_GRATUIDAD_TALLER]);
    return resultado.rows[0] || null;
};

module.exports = Object.freeze({
    CODIGO_AUTORIZACION_GRATUIDAD_TALLER,
    TIPO_FLUJO_TALLER,
    normalizarCodigo,
    esCodigoGratuidadTaller,
    esFlujoTaller,
    obtenerCodigoAutorizacion,
    esGratuidadTallerAutorizada,
    consultarConvenioProtegido,
    consultarCodigoProtegido
});
