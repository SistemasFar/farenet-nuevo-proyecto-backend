const db = require('../../../config/database');
const integrationsConfig = require('../../../config/integrations.config');

const errorConfiguracion = (code, message = code) => {
    const error = new Error(message);
    error.code = code;
    error.statusCode = 503;
    return error;
};

const esEntornoProduccion = (environment) => ['PRODUCCION', 'PRODUCTION'].includes(
    String(environment || '').trim().toUpperCase()
);

const validarSeguridadProduccion = ({
    environment = integrationsConfig.nubefact.environment,
    productionConfirmed = integrationsConfig.nubefact.productionConfirmed,
    enviarSunat = integrationsConfig.nubefact.enviarSunat,
    detractionDecision = integrationsConfig.nubefact.detractionDecision,
    correlativosV2Enabled = integrationsConfig.nubefact.correlativosV2Enabled
} = {}) => {
    const entorno = String(environment || '').trim().toUpperCase();
    if (!['DEMO', 'PRODUCCION', 'PRODUCTION'].includes(entorno)) {
        throw errorConfiguracion('NUBEFACT_ENTORNO_INVALIDO');
    }
    if (!esEntornoProduccion(environment)) return;
    if (!productionConfirmed) throw errorConfiguracion('NUBEFACT_PRODUCCION_NO_CONFIRMADA');
    if (!enviarSunat) throw errorConfiguracion('NUBEFACT_ENVIO_SUNAT_DESHABILITADO');
    if (!correlativosV2Enabled) throw errorConfiguracion('NUBEFACT_CORRELATIVOS_V2_DESHABILITADOS');

    const decision = String(detractionDecision || '').trim().toUpperCase();
    if (decision === 'PENDIENTE') {
        throw errorConfiguracion('NUBEFACT_DETRACCION_PENDIENTE_CONFIRMACION');
    }
    if (decision === 'APLICA') {
        throw errorConfiguracion('NUBEFACT_DETRACCION_CONFIGURACION_PENDIENTE');
    }
    if (decision !== 'NO_APLICA') {
        throw errorConfiguracion('NUBEFACT_DETRACCION_DECISION_INVALIDA');
    }
};

const contextoPublico = (row, credentials = null) => ({
    enabled: integrationsConfig.nubefact.enabled,
    simulationEnabled: integrationsConfig.nubefact.simulationEnabled,
    configured: Boolean(credentials?.apiUrl && credentials?.token
        && credentials?.rucEmisor === String(row?.ruc_emisor || '')),
    provider: 'NUBEFACT',
    environment: row?.entorno || integrationsConfig.nubefact.environment,
    productionConfirmed: integrationsConfig.nubefact.productionConfirmed,
    detractionDecision: integrationsConfig.nubefact.detractionDecision,
    correlativosV2Enabled: integrationsConfig.nubefact.correlativosV2Enabled,
    empresaKey: row?.empresa_key || null,
    rucEmisor: row?.ruc_emisor || null
});

const obtenerFilaConfiguracion = async (plantaKey, executor = db) => {
    const result = await executor.query(`
        SELECT p.key AS planta_key,
               e.key AS empresa_key,
               e.ruc AS ruc_emisor,
               e.nombre AS razon_social_emisor,
               e.direccion AS direccion_emisor,
               f.entorno,
               f.credencial_clave
        FROM fg_planta p
        JOIN fg_empresa e ON e.key = p.empresa_key
        LEFT JOIN fg_empresa_facturador f
          ON f.empresa_key = e.key
         AND f.proveedor = 'NUBEFACT'
         AND f.entorno = $2
         AND f.activo = TRUE
        WHERE p.key = $1
          AND p.activo = TRUE
          AND e.activo = TRUE
        LIMIT 1
    `, [plantaKey, integrationsConfig.nubefact.environment]);
    if (result.rowCount === 0) throw errorConfiguracion('EMPRESA_EMISORA_NO_CONFIGURADA');
    return result.rows[0];
};

exports.obtenerEstadoParaPlanta = async (plantaKey, executor = db) => {
    try {
        const row = await obtenerFilaConfiguracion(plantaKey, executor);
        const credentials = row.credencial_clave
            ? integrationsConfig.nubefact.obtenerCredenciales(row.credencial_clave, row.entorno)
            : null;
        return contextoPublico(row, credentials);
    } catch (error) {
        if (error.code === '42P01') {
            return { ...contextoPublico(null, null), reason: 'MIGRATION_PENDING' };
        }
        throw error;
    }
};

exports.resolverParaPlanta = async (plantaKey, executor = db) => {
    if (!integrationsConfig.nubefact.enabled) {
        throw errorConfiguracion('NUBEFACT_DESHABILITADO');
    }
    validarSeguridadProduccion();
    let row;
    try {
        row = await obtenerFilaConfiguracion(plantaKey, executor);
    } catch (error) {
        if (error.code === '42P01') throw errorConfiguracion('NUBEFACT_CONFIGURACION_PENDIENTE');
        throw error;
    }
    if (!row.credencial_clave) throw errorConfiguracion('EMPRESA_EMISORA_NO_CONFIGURADA');
    if (!/^\d{11}$/.test(String(row.ruc_emisor || ''))) {
        throw errorConfiguracion('EMPRESA_EMISORA_RUC_INVALIDO');
    }

    const credentials = integrationsConfig.nubefact.obtenerCredenciales(row.credencial_clave, row.entorno);
    if (!credentials.apiUrl || !credentials.token) {
        throw errorConfiguracion('NUBEFACT_CREDENCIALES_EMPRESA_FALTANTES');
    }
    if (!/^\d{11}$/.test(credentials.rucEmisor || '')) {
        throw errorConfiguracion('NUBEFACT_CREDENCIALES_RUC_FALTANTE');
    }
    if (credentials.rucEmisor !== String(row.ruc_emisor)) {
        throw errorConfiguracion('NUBEFACT_CREDENCIALES_RUC_NO_COINCIDE');
    }
    if (!/^https:\/\//i.test(credentials.apiUrl)) {
        throw errorConfiguracion('NUBEFACT_RUTA_EMPRESA_INVALIDA');
    }

    return {
        ...contextoPublico(row, credentials),
        plantaKey: row.planta_key,
        razonSocialEmisor: row.razon_social_emisor,
        direccionEmisor: row.direccion_emisor,
        credencialClave: row.credencial_clave,
        credentials
    };
};

exports._private = {
    obtenerFilaConfiguracion,
    contextoPublico,
    errorConfiguracion,
    esEntornoProduccion,
    validarSeguridadProduccion
};
