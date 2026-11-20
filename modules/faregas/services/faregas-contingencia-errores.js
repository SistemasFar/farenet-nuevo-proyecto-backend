const { _private: { esNoEncontrado, esDuplicado } } = require('./faregas-nubefact-correlativo-guard.service');

const mensajes = {
    PROVEEDOR_NO_DISPONIBLE: 'No se pudo establecer una comunicación operativa con NubeFact.',
    TIMEOUT: 'NubeFact no respondió dentro del tiempo permitido.',
    ERROR_SERVIDOR_PROVEEDOR: 'NubeFact devolvió un error de servidor.',
    SATURACION_TEMPORAL: 'NubeFact limitó temporalmente las solicitudes.',
    RESPUESTA_INDETERMINADA: 'La respuesta no permite confirmar el resultado fiscal.',
    LIMITE_DEMO_AGOTADO: 'La cuenta DEMO de NubeFact alcanzó el límite de 50 comprobantes.',
    VALIDACION_RECHAZADA: 'La solicitud fue rechazada por validación. Revise los datos.',
    RECHAZO_FISCAL: 'El proveedor comunicó un rechazo fiscal. Revise el código informado.',
    ERROR_CONFIGURACION: 'La configuración fiscal debe revisarse antes de emitir.',
    ERROR_INTERNO_FAREGAS: 'FAREGAS no pudo completar la operación.'
};

const temporales = new Set([
    'PROVEEDOR_NO_DISPONIBLE', 'TIMEOUT', 'ERROR_SERVIDOR_PROVEEDOR',
    'SATURACION_TEMPORAL', 'RESPUESTA_INDETERMINADA'
]);

const razonesProveedor = {
    TIMEOUT: 'Tiempo de espera agotado',
    NETWORK_ERROR: 'Error de conexión',
    PROVIDER_HTTP_ERROR: 'Error HTTP del proveedor',
    UNEXPECTED_PROVIDER_RESPONSE: 'Respuesta del proveedor sin resultado verificable',
    REJECTED_BY_PROVIDER: 'Solicitud rechazada por el proveedor',
    INVALID_CREDENTIALS: 'Autenticación rechazada',
    MISSING_COMPANY_CREDENTIALS_OR_URL: 'Configuración del emisor incompleta',
    INTEGRATION_DISABLED: 'Integración deshabilitada'
};

const identificarLimiteDemo = (...textos) => textos.some(texto => typeof texto === 'string'
    && /\b50\s+(?:documentos|comprobantes)\b/i.test(texto) && /\bDEMO\b/i.test(texto))
    ? mensajes.LIMITE_DEMO_AGOTADO : null;

const mensajeSeguroProveedor = (resultado, razon, http) => {
    const info = resultado?.data || {};
    if (String(info.sunat_responsecode) === '2119') return 'El documento referenciado no está registrado.';
    return Object.hasOwn(razonesProveedor, razon) ? razonesProveedor[razon] : (http ? 'Respuesta HTTP ' + http : null);
};

const ausenciaConfirmada = (respuesta) =>
    respuesta?.status === 'REJECTED'
    && [200, 400, 404].includes(Number(respuesta.httpStatus))
    && esNoEncontrado(respuesta)
    && !esDuplicado(respuesta)
    && String(respuesta.data?.sunat_responsecode ?? respuesta.data?.codigo ?? '') !== '23'
    && !respuesta.data?.serie && !respuesta.data?.numero && !respuesta.data?.codigo_hash
    && !respuesta.data?.enlace && !respuesta.data?.enlace_pdf && !respuesta.data?.enlace_del_pdf && !respuesta.data?.enlace_del_xml;

const clasificarResultado = (resultado, consulta, intentoId) => {
    const http = Number(resultado?.httpStatus);
    const razon = resultado?.reason;
    const codigoFiscal = String(resultado?.data?.sunat_responsecode ?? '').trim();
    const codigoProveedor = /^\d{1,6}$/.test(codigoFiscal)
        ? codigoFiscal
        : (Object.hasOwn(razonesProveedor, razon) ? razon : ([200, 400, 401, 403, 408, 422, 429, 500, 502, 503, 504].includes(http) ? String(http) : null));
    const info = resultado?.data || {};
    const limiteDemo = resultado?.status === 'REJECTED' && identificarLimiteDemo(info.sunat_description, info.errors, info.message, info.mensaje, info.error);
    let categoria;
    if ([401, 403].includes(http) || ['SKIPPED', 'CONFIGURATION_ERROR'].includes(resultado?.status) || razon === 'INVALID_CREDENTIALS') {
        categoria = 'ERROR_CONFIGURACION';
    } else if (resultado?.status === 'REJECTED' && esDuplicado(resultado)) {
        categoria = 'RESPUESTA_INDETERMINADA';
    } else if (limiteDemo) {
        categoria = 'LIMITE_DEMO_AGOTADO';
    } else if (resultado?.status === 'REJECTED' && codigoFiscal && codigoFiscal !== '0') {
        categoria = 'RECHAZO_FISCAL';
    } else if (http === 429) {
        categoria = 'SATURACION_TEMPORAL';
    } else if (razon === 'TIMEOUT' || http === 408 || http === 504) {
        categoria = 'TIMEOUT';
    } else if ([502, 503].includes(http) || razon === 'NETWORK_ERROR') {
        categoria = 'PROVEEDOR_NO_DISPONIBLE';
    } else if (http >= 500 && http < 600) {
        categoria = 'ERROR_SERVIDOR_PROVEEDOR';
    } else if (resultado?.status === 'REJECTED' || [400, 422].includes(http)) {
        categoria = 'VALIDACION_RECHAZADA';
    } else if (resultado?.provider === 'NUBEFACT') {
        categoria = 'RESPUESTA_INDETERMINADA';
    } else {
        categoria = 'ERROR_INTERNO_FAREGAS';
    }

    const recuperable = temporales.has(categoria);
    return {
        proveedor: 'NubeFact',
        categoria,
        codigoProveedor,
        mensajeOriginalNormalizado: categoria === 'LIMITE_DEMO_AGOTADO' ? null : mensajeSeguroProveedor(resultado, razon, http),
        descripcion: mensajes[categoria],
        recuperable,
        ausenciaConfirmada: (recuperable || categoria === 'LIMITE_DEMO_AGOTADO') && ausenciaConfirmada(consulta),
        seguimiento: intentoId ? 'FG-INTENTO-' + intentoId : null
    };
};

const diagnosticarErrorLocal = (error) => {
    const codigo = String(error?.code || '');
    const limiteDemo = codigo === 'NUBEFACT_RECHAZADO' && identificarLimiteDemo(error.detalles?.motivo);
    const categoria = limiteDemo ? 'LIMITE_DEMO_AGOTADO' : codigo === 'NUBEFACT_VALIDACION_CORRELATIVO_NO_DISPONIBLE'
        ? 'RESPUESTA_INDETERMINADA'
        : /^(DATOS_|CERTIFICADO_NO_VALIDO|PAGO_INCOMPLETO)/.test(codigo)
            ? 'VALIDACION_RECHAZADA'
            : /^(NUBEFACT_(DESHABILITADO|CONFIG|CREDENCIALES|ENTORNO|PRODUCCION)|EMPRESA_EMISORA_|MOTOR_SERIES_|SERIE_)/.test(codigo)
                ? 'ERROR_CONFIGURACION'
                : codigo === 'NUBEFACT_RECHAZADO' ? 'RECHAZO_FISCAL' : 'ERROR_INTERNO_FAREGAS';
    return {
        proveedor: 'NubeFact',
        categoria,
        codigoProveedor: /^[A-Z][A-Z_0-9]{2,79}$/.test(codigo) ? codigo : null,
        mensajeOriginalNormalizado: null,
        descripcion: mensajes[categoria],
        recuperable: categoria === 'RESPUESTA_INDETERMINADA',
        ausenciaConfirmada: false,
        seguimiento: null
    };
};

const coincideRespuestaFiscal = (doc, resultado) => {
    const info = resultado?.data || {};
    const ruc = info.ruc_emisor || info.emisor_ruc;
    const tipo = doc.tipo_comprobante === 'FACTURA' ? 1 : doc.tipo_comprobante === 'BOLETA' ? 2 : null;
    return Boolean(tipo && info.serie && info.numero
        && String(info.serie) === String(doc.serie)
        && Number(info.numero) === Number(doc.numero)
        && Number(info.tipo_de_comprobante) === tipo
        && (!ruc || String(ruc) === String(doc.ruc_emisor))
        && (!info.codigo_unico || info.codigo_unico === doc.codigo_unico)
        && info.anulado !== true && info.anulado !== 'true');
};

module.exports = { identificarLimiteDemo, ausenciaConfirmada, clasificarResultado, coincideRespuestaFiscal, diagnosticarErrorLocal };
