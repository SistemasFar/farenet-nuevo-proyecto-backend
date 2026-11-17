const TELEFONO_MOVIL_PERU = /^9\d{8}$/;

const validarTelefonoVentaChips = (valor) => {
    const telefono = String(valor ?? '').trim();
    if (!telefono) return null;
    if (!TELEFONO_MOVIL_PERU.test(telefono)) {
        const error = new Error('TELEFONO_MOVIL_PERU_INVALIDO');
        error.code = 'TELEFONO_MOVIL_PERU_INVALIDO';
        error.statusCode = 400;
        throw error;
    }
    return telefono;
};

module.exports = { validarTelefonoVentaChips };
