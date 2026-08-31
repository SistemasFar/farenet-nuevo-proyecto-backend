const axios = require('axios');
const config = require('../../config/integrations.config');

/**
 * Cliente HTTP compartido de Nubefact.
 * No conoce reglas de FARENET ni FAREGAS y nunca expone las credenciales.
 */

const obtenerEstadoConfiguracion = (credentials = null) => ({
  enabled: config.nubefact.enabled,
  configured: Boolean(credentials?.apiUrl && credentials?.token),
  environment: config.nubefact.environment,
  provider: 'NUBEFACT'
});

const normalizarRespuesta = (response, options = {}) => {
  const body = response.data || {};
  const aceptada = body.aceptada_por_sunat === true || body.aceptada_por_sunat === 'true';
  const httpOk = response.status >= 200 && response.status < 300;
  const tieneTicket = Boolean(body.sunat_ticket_numero || body.ticket || body.numero_ticket);
  const procesando = httpOk
    && options.responseMode === 'ASYNC_TICKET'
    && !aceptada
    && tieneTicket
    && !body.sunat_responsecode
    && !body.errors;
  return {
    status: httpOk && aceptada ? 'ACCEPTED' : procesando ? 'PROCESSING' : 'REJECTED',
    reason: httpOk
      ? (aceptada ? 'ACCEPTED_BY_SUNAT' : procesando ? 'PENDING_SUNAT' : 'REJECTED_BY_PROVIDER')
      : 'HTTP_ERROR',
    provider: 'NUBEFACT',
    httpStatus: response.status,
    data: body
  };
};

const ejecutar = async (payload, options = {}) => {
  if (!config.nubefact.enabled && !options.ignoreEnabled) {
    return { status: 'SKIPPED', reason: 'INTEGRATION_DISABLED', provider: 'NUBEFACT' };
  }

  const credentials = options.credentials;
  if (!credentials?.apiUrl || !credentials?.token) {
    return {
      status: 'CONFIGURATION_ERROR',
      reason: 'MISSING_COMPANY_CREDENTIALS_OR_URL',
      provider: 'NUBEFACT'
    };
  }

  const httpClient = options.httpClient || axios;
  try {
    const response = await httpClient.post(credentials.apiUrl, payload, {
      headers: {
        // El contrato JSON V1 indica el token sin prefijo Bearer/Token.
        Authorization: credentials.token,
        'Content-Type': 'application/json'
      },
      timeout: config.nubefact.timeoutMs,
      validateStatus: () => true
    });
    return normalizarRespuesta(response, options);
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

const emitirComprobante = (comprobanteData, options = {}) => ejecutar(comprobanteData, options);

const consultarComprobante = ({ tipoDeComprobante, serie, numero }, options = {}) => ejecutar({
  operacion: 'consultar_comprobante',
  tipo_de_comprobante: Number(tipoDeComprobante),
  serie,
  numero: Number(numero)
}, options);

const generarAnulacion = ({ tipoDeComprobante, serie, numero, motivo, codigoUnico = '' }, options = {}) => ejecutar({
  operacion: 'generar_anulacion',
  tipo_de_comprobante: Number(tipoDeComprobante),
  serie,
  numero: Number(numero),
  motivo,
  codigo_unico: codigoUnico
}, { ...options, responseMode: 'ASYNC_TICKET' });

const consultarAnulacion = ({ tipoDeComprobante, serie, numero }, options = {}) => ejecutar({
  operacion: 'consultar_anulacion',
  tipo_de_comprobante: Number(tipoDeComprobante),
  serie,
  numero: Number(numero)
}, { ...options, responseMode: 'ASYNC_TICKET' });

module.exports = {
  emitirComprobante,
  consultarComprobante,
  generarAnulacion,
  consultarAnulacion,
  obtenerEstadoConfiguracion,
  _private: { ejecutar, normalizarRespuesta }
};
