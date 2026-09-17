const db = require('../../../config/database');
const integrationsConfig = require('../../../config/integrations.config');
const { esRucValido } = require('./faregas-facturacion.rules');

const errorConfiguracion = (code, message = code) => {
    const error = new Error(message);
    error.code = code;
    error.statusCode = 503;
    return error;
};

const esEntornoProduccion = (environment) => ['PRODUCCION', 'PRODUCTION'].includes(
    String(environment || '').trim().toUpperCase()
);

const esEntornoDemo = (environment) => String(environment || '').trim().toUpperCase() === 'DEMO';

const aliasDemoPara = (row) => {
    if (!esEntornoDemo(row?.entorno) || row?.empresa_key !== 'FAREGAS') return null;
    return integrationsConfig.nubefact.obtenerAliasDemoFacturador() || null;
};

const validarSeguridadProduccion = ({
    environment = integrationsConfig.nubefact.environment,
    productionConfirmed = integrationsConfig.nubefact.productionConfirmed,
    enviarSunat = integrationsConfig.nubefact.enviarSunat,
    detractionDecision = integrationsConfig.nubefact.detractionDecision,
    correlativosV2Enabled = integrationsConfig.nubefact.correlativosV2Enabled,
    cronReconciliationEnabled = integrationsConfig.nubefact.cronReconciliationEnabled
} = {}) => {
    const entorno = String(environment || '').trim().toUpperCase();
    if (!['DEMO', 'PRODUCCION', 'PRODUCTION'].includes(entorno)) {
        throw errorConfiguracion('NUBEFACT_ENTORNO_INVALIDO');
    }
    if (!esEntornoProduccion(environment)) return;
    if (!productionConfirmed) throw errorConfiguracion('NUBEFACT_PRODUCCION_NO_CONFIRMADA');
    if (!enviarSunat) throw errorConfiguracion('NUBEFACT_ENVIO_SUNAT_DESHABILITADO');
    if (!correlativosV2Enabled) throw errorConfiguracion('NUBEFACT_CORRELATIVOS_V2_DESHABILITADOS');
    if (!cronReconciliationEnabled) {
        throw errorConfiguracion('NUBEFACT_RECONCILIACION_DESHABILITADA');
    }

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
        && esRucValido(credentials?.rucEmisor)
        && esRucValido(row?.ruc_emisor)
        && credentials?.rucEmisor === String(row?.ruc_emisor || '')),
    provider: 'NUBEFACT',
    environment: row?.entorno || integrationsConfig.nubefact.environment,
    productionConfirmed: integrationsConfig.nubefact.productionConfirmed,
    detractionDecision: integrationsConfig.nubefact.detractionDecision,
    correlativosV2Enabled: integrationsConfig.nubefact.correlativosV2Enabled,
    cronReconciliationEnabled: integrationsConfig.nubefact.cronReconciliationEnabled,
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

const obtenerFilaAliasDemo = async (credencialClave, executor = db) => {
    const result = await executor.query(`
        SELECT e.key AS empresa_key,
               e.ruc AS ruc_emisor,
               e.nombre AS razon_social_emisor,
               e.direccion AS direccion_emisor,
               f.entorno,
               f.credencial_clave
        FROM fg_empresa e
        JOIN fg_empresa_facturador f
          ON f.empresa_key = e.key
         AND f.proveedor = 'NUBEFACT'
         AND f.entorno = 'DEMO'
         AND f.credencial_clave = $1
         AND f.activo = TRUE
        WHERE e.key = $1
          AND e.activo = TRUE
        LIMIT 1
    `, [credencialClave]);
    return result.rowCount === 0 ? null : result.rows[0];
};

const resolverFilaEmisora = async (filaPropietaria, executor = db) => {
    const alias = aliasDemoPara(filaPropietaria);
    if (!alias) return { filaEmisora: filaPropietaria, empresaPropietariaKey: filaPropietaria.empresa_key };
    const filaAlias = await obtenerFilaAliasDemo(alias, executor);
    if (!filaAlias) throw errorConfiguracion('NUBEFACT_ALIAS_DEMO_NO_CONFIGURADO');
    return { filaEmisora: filaAlias, empresaPropietariaKey: filaPropietaria.empresa_key };
};

exports.obtenerEstadoParaPlanta = async (plantaKey, executor = db) => {
    try {
        const row = await obtenerFilaConfiguracion(plantaKey, executor);
        const { filaEmisora, empresaPropietariaKey } = await resolverFilaEmisora(row, executor);
        const credentials = filaEmisora.credencial_clave
            ? integrationsConfig.nubefact.obtenerCredenciales(filaEmisora.credencial_clave, filaEmisora.entorno)
            : null;
        return { ...contextoPublico(filaEmisora, credentials), empresaPropietariaKey };
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
    const { filaEmisora, empresaPropietariaKey } = await resolverFilaEmisora(row, executor);
    if (!filaEmisora.credencial_clave) throw errorConfiguracion('EMPRESA_EMISORA_NO_CONFIGURADA');
    if (!esRucValido(filaEmisora.ruc_emisor)) {
        throw errorConfiguracion('EMPRESA_EMISORA_RUC_INVALIDO');
    }

    const credentials = integrationsConfig.nubefact.obtenerCredenciales(filaEmisora.credencial_clave, filaEmisora.entorno);
    if (!credentials.apiUrl || !credentials.token) {
        throw errorConfiguracion('NUBEFACT_CREDENCIALES_EMPRESA_FALTANTES');
    }
    if (!esRucValido(credentials.rucEmisor)) {
        throw errorConfiguracion('NUBEFACT_CREDENCIALES_RUC_FALTANTE');
    }
    if (credentials.rucEmisor !== String(filaEmisora.ruc_emisor)) {
        throw errorConfiguracion('NUBEFACT_CREDENCIALES_RUC_NO_COINCIDE');
    }
    if (!/^https:\/\//i.test(credentials.apiUrl)) {
        throw errorConfiguracion('NUBEFACT_RUTA_EMPRESA_INVALIDA');
    }

    return {
        ...contextoPublico(filaEmisora, credentials),
        plantaKey: row.planta_key,
        empresaPropietariaKey,
        razonSocialEmisor: filaEmisora.razon_social_emisor,
        direccionEmisor: filaEmisora.direccion_emisor,
        credencialClave: filaEmisora.credencial_clave,
        credentials
    };
};

exports._private = {
    obtenerFilaConfiguracion,
    obtenerFilaAliasDemo,
    resolverFilaEmisora,
    aliasDemoPara,
    contextoPublico,
    errorConfiguracion,
    esEntornoProduccion,
    validarSeguridadProduccion
};
