const errorNegocio = (codigo, mensaje, statusCode = 409) => {
    const error = new Error(mensaje);
    error.code = codigo;
    error.statusCode = statusCode;
    return error;
};

const textoRespuesta = (resultado) => {
    const data = resultado?.data || {};
    return [
        data.errors,
        data.error,
        data.mensaje,
        data.message,
        data.sunat_description,
        resultado?.reason,
        resultado?.error
    ].filter(value => value !== undefined && value !== null)
        .map(value => typeof value === 'string' ? value : JSON.stringify(value))
        .join(' ')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
};

const esNoEncontrado = (resultado) => {
    const texto = textoRespuesta(resultado);
    return [
        'documento no existe',
        'documento inexistente',
        'no se encontro el documento',
        'comprobante no existe',
        'comprobante inexistente'
    ].some(fragmento => texto.includes(fragmento));
};

const esDuplicado = (resultado) => {
    const texto = textoRespuesta(resultado);
    return texto.includes('ya existe')
        || texto.includes('duplicado')
        || texto.includes('previamente informado');
};

const esDocumentoEncontrado = (resultado) => {
    const data = resultado?.data || {};
    return Boolean(data.serie || data.numero || data.sunat_responsecode
        || data.codigo_hash || data.enlace_del_pdf || data.enlace_pdf || data.enlace_del_xml);
};

const validarCorrelativoDisponible = async (provider, { tipoComprobante, serie, numero, credentials }) => {
    if (typeof provider?.consultarComprobante !== 'function') {
        throw errorNegocio(
            'NUBEFACT_VALIDACION_CORRELATIVO_NO_DISPONIBLE',
            'No se puede verificar el correlativo en NubeFact; la emisión fue detenida.',
            503
        );
    }

    let consulta;
    try {
        consulta = await provider.consultarComprobante({
            tipoDeComprobante: tipoComprobante === 'FACTURA' ? 1 : 2,
            serie,
            numero
        }, { credentials });
    } catch (_) {
        throw errorNegocio(
            'NUBEFACT_VALIDACION_CORRELATIVO_NO_DISPONIBLE',
            'NubeFact no permitió verificar el correlativo; la emisión fue detenida.',
            503
        );
    }

    // Solo la respuesta explícita de inexistencia habilita el POST. Un error,
    // rechazo distinto, respuesta ambigua o documento encontrado bloquea.
    if (consulta?.status === 'REJECTED' && esNoEncontrado(consulta) && !esDuplicado(consulta)) {
        return { disponible: true };
    }

    if (['ACCEPTED', 'PENDING_SUNAT'].includes(consulta?.status)
        || esDuplicado(consulta)
        || (consulta?.status === 'REJECTED' && esDocumentoEncontrado(consulta))) {
        throw errorNegocio(
            'NUBEFACT_CORRELATIVO_OCUPADO',
            `El comprobante ${serie}-${String(numero).padStart(8, '0')} ya existe en NubeFact. No se envió otra emisión.`,
            409
        );
    }

    throw errorNegocio(
        'NUBEFACT_VALIDACION_CORRELATIVO_NO_DISPONIBLE',
        `NubeFact no confirmó que ${serie}-${String(numero).padStart(8, '0')} esté libre; la emisión fue detenida.`,
        503
    );
};

module.exports = {
    validarCorrelativoDisponible,
    _private: { textoRespuesta, esNoEncontrado, esDuplicado, esDocumentoEncontrado }
};
