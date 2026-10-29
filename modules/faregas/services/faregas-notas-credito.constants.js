const MOTIVOS_NOTA_CREDITO = Object.freeze({
    '01': Object.freeze({
        codigo: '01',
        descripcion: 'ANULACION DE LA OPERACION',
        requiereSolicitud: true,
        modificaDescripcion: false
    }),
    '02': Object.freeze({
        codigo: '02',
        descripcion: 'ANULACION POR ERROR EN EL RUC',
        requiereSolicitud: true,
        modificaDescripcion: false
    }),
    '03': Object.freeze({
        codigo: '03',
        descripcion: 'CORRECCION POR ERROR EN LA DESCRIPCION',
        requiereSolicitud: false,
        modificaDescripcion: true
    })
});

// Se conservan las variantes históricas sin cero únicamente al consultar datos
// ya persistidos. Toda emisión nueva se normaliza a dos dígitos.
const CODIGOS_HISTORICOS_ANULACION = Object.freeze(['01', '1', '02', '2']);
const SQL_CODIGOS_HISTORICOS_ANULACION = CODIGOS_HISTORICOS_ANULACION
    .map((codigo) => `'${codigo}'`)
    .join(', ');

const normalizarMotivoNotaCredito = (valor) => {
    const bruto = String(valor ?? '').trim();
    if (!/^\d{1,2}$/.test(bruto)) return null;
    const codigo = bruto.padStart(2, '0');
    return MOTIVOS_NOTA_CREDITO[codigo]?.codigo || null;
};

const obtenerMotivoNotaCredito = (valor) => {
    const codigo = normalizarMotivoNotaCredito(valor);
    return codigo ? MOTIVOS_NOTA_CREDITO[codigo] : null;
};

const requiereSolicitudNotaCredito = (valor) => (
    obtenerMotivoNotaCredito(valor)?.requiereSolicitud === true
);

const esMotivoCorreccionDescripcion = (valor) => (
    obtenerMotivoNotaCredito(valor)?.modificaDescripcion === true
);

const esMotivoAnulacionNotaCredito = (valor) => {
    const codigo = normalizarMotivoNotaCredito(valor);
    return codigo === '01' || codigo === '02';
};

module.exports = {
    MOTIVOS_NOTA_CREDITO,
    CODIGOS_HISTORICOS_ANULACION,
    SQL_CODIGOS_HISTORICOS_ANULACION,
    normalizarMotivoNotaCredito,
    obtenerMotivoNotaCredito,
    requiereSolicitudNotaCredito,
    esMotivoCorreccionDescripcion,
    esMotivoAnulacionNotaCredito
};
