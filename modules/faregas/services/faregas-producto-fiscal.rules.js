const UNIDADES_TRIBUTARIAS_ADMITIDAS = Object.freeze(['NIU', 'ZZ']);

const normalizarUnidadTributaria = (value) => String(value ?? '').trim().toUpperCase();

const esUnidadTributariaAdmitida = (value) => (
    UNIDADES_TRIBUTARIAS_ADMITIDAS.includes(normalizarUnidadTributaria(value))
);

module.exports = {
    UNIDADES_TRIBUTARIAS_ADMITIDAS,
    normalizarUnidadTributaria,
    esUnidadTributariaAdmitida
};
