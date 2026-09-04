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

const normalizarEntornoNubefact = (value = 'DEMO') => {
  const entorno = String(value || '').trim().toUpperCase();
  if (entorno === 'PRODUCTION') return 'PRODUCCION';
  return entorno || 'DEMO';
};

const obtenerCredencialesNubefact = (credencialClave, environment = 'DEMO') => {
  const clave = normalizarClaveCredencial(credencialClave);
  const entorno = normalizarEntornoNubefact(environment);
  const prefijo = clave ? `NUBEFACT_${clave}_${entorno}` : '';
  const apiUrl = prefijo ? String(process.env[`${prefijo}_API_URL`] || '').trim() : '';
  const token = prefijo ? String(process.env[`${prefijo}_TOKEN`] || '').trim() : '';
  const rucEmisor = prefijo ? String(process.env[`${prefijo}_RUC`] || '').trim() : '';

  if (apiUrl && token) return Object.freeze({ apiUrl, token, rucEmisor, source: prefijo });

  // Compatibilidad limitada para instalaciones DEMO anteriores. En producción
  // las credenciales siempre deben estar separadas por ambiente.
  const permitirClaveLegacy = entorno === 'DEMO'
    && getBooleanEnv('NUBEFACT_ALLOW_LEGACY_CREDENTIAL_KEYS', false);
  const prefijoLegacy = clave ? `NUBEFACT_${clave}` : '';
  const legacyApiUrl = permitirClaveLegacy
    ? String(process.env[`${prefijoLegacy}_API_URL`] || '').trim()
    : '';
  const legacyToken = permitirClaveLegacy
    ? String(process.env[`${prefijoLegacy}_TOKEN`] || '').trim()
    : '';
  const legacyRuc = permitirClaveLegacy
    ? String(process.env[`${prefijoLegacy}_RUC`] || '').trim()
    : '';
  if (legacyApiUrl && legacyToken) {
    return Object.freeze({ apiUrl: legacyApiUrl, token: legacyToken, rucEmisor: legacyRuc, source: prefijoLegacy });
  }

  const permitirGlobal = getBooleanEnv('NUBEFACT_ALLOW_GLOBAL_FALLBACK', false);
  if (permitirGlobal && process.env.NUBEFACT_API_URL && process.env.NUBEFACT_TOKEN) {
    return Object.freeze({
      apiUrl: process.env.NUBEFACT_API_URL,
      token: process.env.NUBEFACT_TOKEN,
      source: 'NUBEFACT_GLOBAL_FALLBACK'
    });
  }

  return Object.freeze({ apiUrl: '', token: '', rucEmisor: '', source: prefijo || null });
};

const nubefactEnabled = getBooleanEnv('NUBEFACT_ENABLED', false);
const nubefactSimulationEnabled = !nubefactEnabled
  && process.env.NODE_ENV !== 'production'
  && getBooleanEnv('NUBEFACT_SIMULATION_ENABLED', false);
const nubefactEnvironment = normalizarEntornoNubefact(process.env.NUBEFACT_ENVIRONMENT || 'DEMO');
const nubefactDetractionDecision = String(
  process.env.NUBEFACT_DETRACCION_DECISION || 'PENDIENTE'
).trim().toUpperCase();

// Se congelan los objetos exportados para mantenerlos inmutables
const config = Object.freeze({
  nubefact: Object.freeze({
    enabled: nubefactEnabled,
    simulationEnabled: nubefactSimulationEnabled,
    environment: nubefactEnvironment,
    productionConfirmed: getBooleanEnv('NUBEFACT_PRODUCTION_CONFIRMED', false),
    detractionDecision: nubefactDetractionDecision,
    allowGlobalFallback: getBooleanEnv('NUBEFACT_ALLOW_GLOBAL_FALLBACK', false),
    timeoutMs: getIntegerEnv('NUBEFACT_TIMEOUT_MS', 10000),
    retryLockMs: getIntegerEnv('NUBEFACT_RETRY_LOCK_MS', 120000),
    maxAttempts: getIntegerEnv('NUBEFACT_MAX_ATTEMPTS', 5),
    enviarSunat: getBooleanEnv('NUBEFACT_ENVIAR_SUNAT', false),
    enviarCliente: getBooleanEnv('NUBEFACT_ENVIAR_CLIENTE', false),
    correlativosV2Enabled: getBooleanEnv('NUBEFACT_CORRELATIVOS_V2_ENABLED', false),
    cronReconciliationEnabled: getBooleanEnv('NUBEFACT_RECONCILIATION_ENABLED', false),
    obtenerCredenciales: obtenerCredencialesNubefact
  })
});

module.exports = config;
