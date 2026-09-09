const normalizarNumeroChip = (valor) => String(valor || '').trim().toUpperCase();

const esNumeroChipCertificadoValido = (valor) => /^[A-Z0-9]{1,15}$/.test(normalizarNumeroChip(valor));

const normalizarLoteScanner = (valor) => {
    const vistos = new Set();
    const validos = [];
    const duplicados = [];
    const errores = [];
    String(valor || '').split(/[\r\n,;\t]+/).forEach((entrada) => {
        const numero = normalizarNumeroChip(entrada);
        if (!numero) return;
        if (numero.length > 120 || !/^[A-Z0-9._\/-]+$/.test(numero)) {
            errores.push(numero);
        } else if (vistos.has(numero)) {
            duplicados.push(numero);
        } else {
            vistos.add(numero);
            validos.push(numero);
        }
    });
    return { validos, duplicados, errores };
};

module.exports = { normalizarNumeroChip, esNumeroChipCertificadoValido, normalizarLoteScanner };
