const db = require('../../../config/database');
const integrationsConfig = require('../../../config/integrations.config');

const errorConfiguracion = (code, message = code) => {
    const error = new Error(message);
    error.code = code;
    error.statusCode = 503;
    return error;
};

const contextoPublico = (row, credentials = null) => ({
    enabled: integrationsConfig.nubefact.enabled,
    configured: Boolean(credentials?.apiUrl && credentials?.token),
    provider: 'NUBEFACT',
    environment: row?.entorno || integrationsConfig.nubefact.environment,
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
    if (!integrationsConfig.nubefact.enabled) return contextoPublico(null, null);
    try {
        const row = await obtenerFilaConfiguracion(plantaKey, executor);
        const credentials = row.credencial_clave
            ? integrationsConfig.nubefact.obtenerCredenciales(row.credencial_clave)
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

    const credentials = integrationsConfig.nubefact.obtenerCredenciales(row.credencial_clave);
    if (!credentials.apiUrl || !credentials.token) {
        throw errorConfiguracion('NUBEFACT_CREDENCIALES_EMPRESA_FALTANTES');
    }
    if (!/^https?:\/\//i.test(credentials.apiUrl)) {
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

exports._private = { obtenerFilaConfiguracion, contextoPublico, errorConfiguracion };
