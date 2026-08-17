const axios = require('axios');
const config = require('../../config/integrations.config');

/**
 * Cliente compartido de facturacion electronica.
 * No contiene reglas de Farenet ni Faregas: recibe el contrato de Nubefact y
 * devuelve una respuesta normalizada sin exponer credenciales.
 */

const obtenerEstadoConfiguracion = () => ({
  enabled: config.nubefact.enabled,
  configured: Boolean(config.nubefact.apiUrl && config.nubefact.token),
  provider: 'NUBEFACT'
});

const emitirComprobante = async (comprobanteData, options = {}) => {
  if (!config.nubefact.enabled) {
    return {
      status: 'SKIPPED',
      reason: 'INTEGRATION_DISABLED',
      provider: 'NUBEFACT'
    };
  }

  if (!config.nubefact.apiUrl || !config.nubefact.token) {
    return {
      status: 'CONFIGURATION_ERROR',
      reason: 'MISSING_CREDENTIALS_OR_URL',
      provider: 'NUBEFACT'
    };
  }

  const httpClient = options.httpClient || axios;
  try {
    const response = await httpClient.post(config.nubefact.apiUrl, comprobanteData, {
      headers: {
        Authorization: `Token token=${config.nubefact.token}`,
        'Content-Type': 'application/json'
      },
      timeout: config.nubefact.timeoutMs,
      validateStatus: () => true
    });

    const body = response.data || {};
    const aceptada = body.aceptada_por_sunat === true || body.aceptada_por_sunat === 'true';
    const httpOk = response.status >= 200 && response.status < 300;

    return {
      status: httpOk && aceptada ? 'ACCEPTED' : 'REJECTED',
      reason: httpOk ? (aceptada ? 'ACCEPTED_BY_SUNAT' : 'REJECTED_BY_PROVIDER') : 'HTTP_ERROR',
      provider: 'NUBEFACT',
      httpStatus: response.status,
      data: body
    };
  } catch (error) {
    return {
      status: 'ERROR',
      reason: error.code === 'ECONNABORTED' ? 'TIMEOUT' : 'NETWORK_ERROR',
      provider: 'NUBEFACT',
      httpStatus: error.response?.status || null,
      data: error.response?.data || null,
      error: error.message
    };
  }
};

module.exports = {
  emitirComprobante,
  obtenerEstadoConfiguracion
};
