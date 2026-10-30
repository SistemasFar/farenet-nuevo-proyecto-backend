const MOTIVOS_NOTA_CREDITO = Object.freeze({
    '01': Object.freeze({
        codigo: '01',
        descripcion: 'ANULACION DE LA OPERACION',
        requiereSolicitud: true,
        modificaDescripcion: false,
        implementado: true
    }),
    '02': Object.freeze({
        codigo: '02',
        descripcion: 'ANULACION POR ERROR EN EL RUC',
        requiereSolicitud: true,
        modificaDescripcion: false,
        implementado: true
    }),
    '03': Object.freeze({
        codigo: '03',
        descripcion: 'CORRECCION POR ERROR EN LA DESCRIPCION',
        requiereSolicitud: true,
        modificaDescripcion: true,
        implementado: true
    }),
    '04': Object.freeze({
        codigo: '04',
        descripcion: 'DESCUENTO GLOBAL',
        requiereSolicitud: false,
        modificaDescripcion: false,
        implementado: false
    }),
    '05': Object.freeze({
        codigo: '05',
        descripcion: 'DESCUENTO POR ITEM',
        requiereSolicitud: false,
        modificaDescripcion: false,
        implementado: false
    }),
    '06': Object.freeze({
        codigo: '06',
        descripcion: 'DEVOLUCION TOTAL',
        requiereSolicitud: false,
        modificaDescripcion: false,
        implementado: false
    }),
    '07': Object.freeze({
        codigo: '07',
        descripcion: 'DEVOLUCION POR ITEM',
        requiereSolicitud: false,
        modificaDescripcion: false,
        implementado: false
    }),
    '08': Object.freeze({
        codigo: '08',
        descripcion: 'BONIFICACION',
        requiereSolicitud: false,
        modificaDescripcion: false,
        implementado: false
    }),
    '09': Object.freeze({
        codigo: '09',
        descripcion: 'DISMINUICION EN EL VALOR',
        requiereSolicitud: false,
        modificaDescripcion: false,
        implementado: false
    }),
    '10': Object.freeze({
        codigo: '10',
        descripcion: 'OTROS CONCEPTOS',
        requiereSolicitud: false,
        modificaDescripcion: false,
        implementado: false
    }),
    '11': Object.freeze({
        codigo: '11',
        descripcion: 'AJUSTES AFECTOS AL IVAP',
        requiereSolicitud: false,
        modificaDescripcion: false,
        implementado: false
    }),
    '12': Object.freeze({
        codigo: '12',
        descripcion: 'AJUSTES DE OPERACIONES DE EXPORTACION',
        requiereSolicitud: false,
        modificaDescripcion: false,
        implementado: false
    }),
    '13': Object.freeze({
        codigo: '13',
        descripcion: 'AJUSTES DE MONTOS Y/O FECHAS DE PAGO',
        requiereSolicitud: false,
        modificaDescripcion: false,
        implementado: false
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

const esMotivoImplementado = (valor) => {
    const codigo = normalizarMotivoNotaCredito(valor);
    return codigo ? MOTIVOS_NOTA_CREDITO[codigo]?.implementado === true : false;
};

module.exports = {
    MOTIVOS_NOTA_CREDITO,
    CODIGOS_HISTORICOS_ANULACION,
    SQL_CODIGOS_HISTORICOS_ANULACION,
    normalizarMotivoNotaCredito,
    obtenerMotivoNotaCredito,
    requiereSolicitudNotaCredito,
    esMotivoCorreccionDescripcion,
    esMotivoAnulacionNotaCredito,
    esMotivoImplementado
};
