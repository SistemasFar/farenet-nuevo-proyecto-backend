const CODIGO_AUTORIZACION_CORTESIA = 'CORTESIA_FAREGAS';
const CODIGO_AUTORIZACION_GRATUIDAD_TALLER = 'DESCUENTO_TALLER';
const CODIGO_AUTORIZACION_CONVENIO_HISTORICO = 'D_CONVENIO_A88137BB742F4157';
const DESCUENTO_ID_CORTESIA_HISTORICO = 17;
const TIPO_FLUJO_TALLER = 'TALLER_INSPECCION';

const normalizarCodigo = (value) => String(value || '').trim().toUpperCase();

const esCodigoGratuidadTaller = (value) => (
    normalizarCodigo(value) === CODIGO_AUTORIZACION_GRATUIDAD_TALLER
);

const esCodigoCortesia = (value) => {
    const codigo = normalizarCodigo(value);
    return codigo === CODIGO_AUTORIZACION_CORTESIA
        || codigo === CODIGO_AUTORIZACION_GRATUIDAD_TALLER
        || codigo === CODIGO_AUTORIZACION_CONVENIO_HISTORICO;
};

const esFlujoTaller = (value) => normalizarCodigo(value) === TIPO_FLUJO_TALLER;

const obtenerCodigoAutorizacion = (reserva) => {
    if (!reserva || typeof reserva !== 'object') return '';
    return (
        reserva.codigo_autorizacion
        || reserva.codigoAutorizacion
        || reserva.codigo
        || ''
    );
};

const esCortesiaAutorizada = ({ reserva = null } = {}) => {
    if (!reserva || typeof reserva !== 'object') return false;
    const descuentoId = Number(reserva.descuento_id || reserva.descuentoId || 0);
    const nombre = normalizarCodigo(reserva.descuento_nombre || reserva.nombre || '');
    const modalidad = normalizarCodigo(reserva.modalidad_comercial || reserva.modalidadComercial || '');
    return reserva.autoriza_gratuidad === true
        || reserva.autorizaGratuidad === true
        || modalidad === 'CORTESIA'
        || descuentoId === DESCUENTO_ID_CORTESIA_HISTORICO
        || nombre === 'DESCUENTO CERTIFICADO TALLER'
        || nombre.includes('CORTESIA')
        || nombre.includes('CORTESÍA')
        || esCodigoCortesia(obtenerCodigoAutorizacion(reserva));
};

// Alias conservado para no romper los consumidores existentes. La cortesía ya
// no depende del flujo TALLER_INSPECCION; la autorización debe estar persistida.
const esGratuidadTallerAutorizada = (opciones = {}) => esCortesiaAutorizada(opciones);

const consultarConvenioProtegido = async (queryable, descuentoId, bloquear = false) => {
    const resultado = await queryable.query(`
        SELECT d.id, d.codigo, d.nombre, dc.id AS codigo_id,
               COALESCE(dc.codigo, 'CORTESIA_FAREGAS') AS codigo_autorizacion
        FROM fg_descuento d
        LEFT JOIN fg_descuentocliente dc ON dc.descuento_id = d.id
             AND UPPER(BTRIM(dc.codigo)) IN ('CORTESIA_FAREGAS', 'DESCUENTO_TALLER')
        WHERE d.id = $1
          AND (
              d.id = 17
              OR UPPER(BTRIM(d.codigo)) = ANY($2::varchar[])
              OR UPPER(BTRIM(dc.codigo)) = ANY($2::varchar[])
              OR UPPER(BTRIM(d.nombre)) IN ('DESCUENTO CERTIFICADO TALLER', 'CORTESIA FAREGAS', 'CORTESÍA FAREGAS')
          )
        ORDER BY dc.id ASC NULLS LAST
        LIMIT 1
        ${bloquear ? 'FOR UPDATE OF d' : ''}
    `, [descuentoId, [CODIGO_AUTORIZACION_CORTESIA, CODIGO_AUTORIZACION_GRATUIDAD_TALLER, CODIGO_AUTORIZACION_CONVENIO_HISTORICO]]);
    return resultado.rows[0] || null;
};

const consultarCodigoProtegido = async (queryable, codigoId, bloquear = false) => {
    const resultado = await queryable.query(`
        SELECT dc.id, dc.descuento_id, dc.codigo
        FROM fg_descuentocliente dc
        JOIN fg_descuento d ON d.id = dc.descuento_id
        WHERE dc.id = $1
          AND (
              UPPER(BTRIM(dc.codigo)) = ANY($2::varchar[])
              OR d.id = 17
              OR UPPER(BTRIM(d.codigo)) = ANY($2::varchar[])
          )
        ${bloquear ? 'FOR UPDATE OF dc' : ''}
    `, [codigoId, [CODIGO_AUTORIZACION_CORTESIA, CODIGO_AUTORIZACION_GRATUIDAD_TALLER, CODIGO_AUTORIZACION_CONVENIO_HISTORICO]]);
    return resultado.rows[0] || null;
};

module.exports = Object.freeze({
    CODIGO_AUTORIZACION_CORTESIA,
    CODIGO_AUTORIZACION_GRATUIDAD_TALLER,
    CODIGO_AUTORIZACION_CONVENIO_HISTORICO,
    DESCUENTO_ID_CORTESIA_HISTORICO,
    TIPO_FLUJO_TALLER,
    normalizarCodigo,
    esCodigoGratuidadTaller,
    esCodigoCortesia,
    esFlujoTaller,
    obtenerCodigoAutorizacion,
    esCortesiaAutorizada,
    esGratuidadTallerAutorizada,
    consultarConvenioProtegido,
    consultarCodigoProtegido
});
