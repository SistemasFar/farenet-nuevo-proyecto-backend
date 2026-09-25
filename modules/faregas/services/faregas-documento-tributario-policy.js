const integrationsConfig = require('../../../config/integrations.config');

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

// ---------------------------------------------------------------------------
// Limpieza local de comprobantes (categorías de prueba)
//
// La autorización se decide SIEMPRE en backend a partir de la configuración
// real de integraciones. El frontend jamás puede habilitarla por parámetro.
// ---------------------------------------------------------------------------

const entornoFacturacionEfectivo = () => normalizarEntorno(integrationsConfig.nubefact.environment);

const esAmbienteFacturacionProduccion = (environment = integrationsConfig.nubefact.environment) => (
    normalizarEntorno(environment) === 'PRODUCCION'
);

/**
 * Sólo en ambiente no productivo se permite el borrado local de comprobantes
 * de prueba. Una instalación confirmada como productiva queda bloqueada aunque
 * el ambiente declarado sea DEMO.
 */
const permiteLimpiezaLocalDeComprobantes = (environment = integrationsConfig.nubefact.environment) => (
    !esAmbienteFacturacionProduccion(environment)
    && integrationsConfig.nubefact.productionConfirmed !== true
);

/**
 * Puerta general de limpieza de datos de prueba (tipos de chip, campanas y
 * descuentos, etc.). Misma fuente autoritativa: integrations.config.
 */
const permiteLimpiezaDeDatosDePrueba = (environment = integrationsConfig.nubefact.environment) => (
    !esAmbienteFacturacionProduccion(environment)
    && integrationsConfig.nubefact.productionConfirmed !== true
);

/**
 * Un documento individual marcado como PRODUCCION nunca se borra, aunque la
 * instalación completa esté en DEMO.
 */
const esDocumentoFacturacionDemoLocal = (documento, environment = integrationsConfig.nubefact.environment) => {
    if (!permiteLimpiezaLocalDeComprobantes(environment)) return false;
    return normalizarEntorno(documento?.entorno_facturador) !== 'PRODUCCION';
};

module.exports = {
    normalizarEntorno,
    esAceptadoPorSunat,
    esDemoGeneradoPorNubefact,
    esDocumentoBaseOperable,
    entornoFacturacionEfectivo,
    esAmbienteFacturacionProduccion,
    permiteLimpiezaLocalDeComprobantes,
    permiteLimpiezaDeDatosDePrueba,
    esDocumentoFacturacionDemoLocal
};
