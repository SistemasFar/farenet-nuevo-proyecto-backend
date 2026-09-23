const normalizarEntorno = (value) => {
    const entorno = String(value || '').trim().toUpperCase();
    return entorno === 'PRODUCTION' ? 'PRODUCCION' : entorno;
};

const esAceptadoPorSunat = (documento) => (
    String(documento?.estado || '').trim().toUpperCase() === 'ACEPTADO'
    && documento?.aceptada_sunat === true
);

/**
 * En DEMO NubeFact genera el comprobante, PDF y XML, pero responde
 * aceptada_por_sunat=false porque el documento no tiene valor legal. Esa
 * respuesta es suficiente para probar documentos relacionados sin relajar
 * la regla productiva de CDR aceptado.
 */
const esDemoGeneradoPorNubefact = (documento) => {
    const entorno = normalizarEntorno(documento?.entorno_facturador);
    const estado = String(documento?.estado || '').trim().toUpperCase();
    const proveedor = String(documento?.proveedor || '').trim().toUpperCase();
    const tieneIdentidad = Boolean(documento?.nro_comprobante && documento?.serie && documento?.numero !== null);
    const tieneArtefacto = Boolean(documento?.enlace_pdf || documento?.enlace_xml);

    return entorno === 'DEMO'
        && proveedor === 'NUBEFACT'
        && estado === 'PENDIENTE_SUNAT'
        && tieneIdentidad
        && tieneArtefacto;
};

const esDocumentoBaseOperable = (documento) => (
    esAceptadoPorSunat(documento) || esDemoGeneradoPorNubefact(documento)
);

module.exports = {
    normalizarEntorno,
    esAceptadoPorSunat,
    esDemoGeneradoPorNubefact,
    esDocumentoBaseOperable
};
