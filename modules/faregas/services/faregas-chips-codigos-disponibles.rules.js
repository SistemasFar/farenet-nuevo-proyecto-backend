const MAX_CODIGOS_POR_PROPUESTA = 500;
const MAX_INTENTOS_BUSQUEDA = 50000;
const MAX_LONGITUD_CODIGO = 120;

const crearError = (codigo, detalles) => {
    const error = new Error(codigo);
    error.code = codigo;
    error.statusCode = 400;
    if (detalles !== undefined) error.detalles = detalles;
    return error;
};

const normalizarSolicitudCodigosDisponibles = ({ prefijo, cantidad, digitos, minimo }) => {
    const prefijoNormalizado = String(prefijo || '').trim().toUpperCase();
    if (!prefijoNormalizado || prefijoNormalizado.length > 80 || !/^[A-Z0-9._\/-]+$/.test(prefijoNormalizado)) {
        throw crearError('CODIGOS_DISPONIBLES_SOLICITUD_INVALIDA', 'El prefijo debe tener entre 1 y 80 caracteres alfanuméricos o . _ / -.');
    }

    const cantidadNumerica = Number(cantidad);
    const digitosNumericos = Number(digitos);
    const digitosMinimos = minimo === undefined || minimo === null || String(minimo).trim() === ''
        ? 1n
        : (() => {
            try { return BigInt(String(minimo).trim()); } catch { return -1n; }
        })();

    if (!Number.isInteger(cantidadNumerica) || cantidadNumerica < 1 || cantidadNumerica > MAX_CODIGOS_POR_PROPUESTA
        || !Number.isInteger(digitosNumericos) || digitosNumericos < 1 || digitosNumericos > 15
        || digitosMinimos < 0n) {
        throw crearError('CODIGOS_DISPONIBLES_SOLICITUD_INVALIDA', `Cantidad entre 1 y ${MAX_CODIGOS_POR_PROPUESTA}, dígitos entre 1 y 15 y número mínimo entero no negativo.`);
    }

    return {
        prefijo: prefijoNormalizado,
        cantidad: cantidadNumerica,
        digitos: digitosNumericos,
        minimo: digitosMinimos
    };
};

const formatearCodigoDisponible = ({ prefijo, numero, digitos }) => {
    const valor = typeof numero === 'bigint' ? numero : BigInt(numero);
    const codigo = `${prefijo}${valor.toString().padStart(digitos, '0')}`;
    if (codigo.length > MAX_LONGITUD_CODIGO || !/^[A-Z0-9._\/-]+$/.test(codigo)) {
        throw crearError('CODIGOS_DISPONIBLES_SOLICITUD_INVALIDA', 'El código propuesto supera el formato admitido para chips.');
    }
    return codigo;
};

const generarCodigosDisponibles = ({ prefijo, cantidad, digitos, minimo = 1, ocupados = [], limiteIntentos = MAX_INTENTOS_BUSQUEDA }) => {
    const solicitud = normalizarSolicitudCodigosDisponibles({ prefijo, cantidad, digitos, minimo });
    const limite = Number(limiteIntentos);
    if (!Number.isInteger(limite) || limite < solicitud.cantidad || limite > MAX_INTENTOS_BUSQUEDA) {
        throw crearError('CODIGOS_DISPONIBLES_SOLICITUD_INVALIDA');
    }
    const ocupadosNormalizados = new Set((ocupados || []).map((codigo) => String(codigo).trim().toUpperCase()));
    const codigos = [];
    const omitidos = [];
    let numero = solicitud.minimo;
    let intentos = 0;

    while (codigos.length < solicitud.cantidad && intentos < limite) {
        const codigo = formatearCodigoDisponible({ ...solicitud, numero });
        if (ocupadosNormalizados.has(codigo)) omitidos.push(codigo);
        else codigos.push(codigo);
        numero += 1n;
        intentos += 1;
    }

    if (codigos.length !== solicitud.cantidad) {
        throw crearError('CODIGOS_DISPONIBLES_NO_ENCONTRADOS', {
            solicitados: solicitud.cantidad,
            encontrados: codigos.length,
            omitidos,
            intentos
        });
    }

    return { ...solicitud, codigos, omitidos, siguienteNumero: numero, intentos };
};

module.exports = {
    MAX_CODIGOS_POR_PROPUESTA,
    MAX_INTENTOS_BUSQUEDA,
    normalizarSolicitudCodigosDisponibles,
    formatearCodigoDisponible,
    generarCodigosDisponibles
};
