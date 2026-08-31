/**
 * Configuración centralizada e inmutable de integraciones externas (Nubefact, MTC)
 */

const getBooleanEnv = (key, defaultValue = false) => {
  const val = process.env[key];
  if (val === undefined || val === null) return defaultValue;
  return val.toString().toLowerCase() === 'true';
};

const getIntegerEnv = (key, defaultValue) => {
  const val = process.env[key];
  if (val === undefined || val === null) return defaultValue;
  const parsed = parseInt(val, 10);
  return isNaN(parsed) ? defaultValue : parsed;
};

const normalizarClaveCredencial = (value) => String(value || '')
  .trim()
  .toUpperCase()
  .replace(/[^A-Z0-9_]/g, '_')
  .replace(/_+/g, '_')
  .replace(/^_|_$/g, '');

const obtenerCredencialesNubefact = (credencialClave) => {
  const clave = normalizarClaveCredencial(credencialClave);
  const prefijo = clave ? `NUBEFACT_${clave}` : '';
  const apiUrl = prefijo ? process.env[`${prefijo}_API_URL`] || '' : '';
  const token = prefijo ? process.env[`${prefijo}_TOKEN`] || '' : '';

  if (apiUrl && token) return Object.freeze({ apiUrl, token, source: prefijo });

  const permitirGlobal = getBooleanEnv('NUBEFACT_ALLOW_GLOBAL_FALLBACK', false);
  if (permitirGlobal && process.env.NUBEFACT_API_URL && process.env.NUBEFACT_TOKEN) {
    return Object.freeze({
      apiUrl: process.env.NUBEFACT_API_URL,
      token: process.env.NUBEFACT_TOKEN,
      source: 'NUBEFACT_GLOBAL_FALLBACK'
    });
  }

  return Object.freeze({ apiUrl: '', token: '', source: prefijo || null });
};

const nubefactEnabled = getBooleanEnv('NUBEFACT_ENABLED', false);
const nubefactSimulationEnabled = !nubefactEnabled
  && process.env.NODE_ENV !== 'production'
  && getBooleanEnv('NUBEFACT_SIMULATION_ENABLED', false);

// Se congelan los objetos exportados para mantenerlos inmutables
const config = Object.freeze({
  nubefact: Object.freeze({
    enabled: nubefactEnabled,
    simulationEnabled: nubefactSimulationEnabled,
    environment: String(process.env.NUBEFACT_ENVIRONMENT || 'DEMO').trim().toUpperCase(),
    allowGlobalFallback: getBooleanEnv('NUBEFACT_ALLOW_GLOBAL_FALLBACK', false),
    timeoutMs: getIntegerEnv('NUBEFACT_TIMEOUT_MS', 10000),
    enviarSunat: getBooleanEnv('NUBEFACT_ENVIAR_SUNAT', false),
    enviarCliente: getBooleanEnv('NUBEFACT_ENVIAR_CLIENTE', false),
    obtenerCredenciales: obtenerCredencialesNubefact
  })
});

module.exports = config;
