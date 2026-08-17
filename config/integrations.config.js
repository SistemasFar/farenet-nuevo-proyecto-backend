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

// Se congelan los objetos exportados para mantenerlos inmutables
const config = Object.freeze({
  nubefact: Object.freeze({
    enabled: getBooleanEnv('NUBEFACT_ENABLED', false),
    apiUrl: process.env.NUBEFACT_API_URL || '',
    token: process.env.NUBEFACT_TOKEN || '',
    timeoutMs: getIntegerEnv('NUBEFACT_TIMEOUT_MS', 10000),
    enviarSunat: getBooleanEnv('NUBEFACT_ENVIAR_SUNAT', true),
    enviarCliente: getBooleanEnv('NUBEFACT_ENVIAR_CLIENTE', true)
  })
});

module.exports = config;
