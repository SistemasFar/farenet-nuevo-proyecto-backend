const config = require('../../config/integrations.config');

/**
 * @typedef {Object} IntegrationResult
 * @property {string} status - Estado de la ejecución (SKIPPED, NOT_IMPLEMENTED, CONFIGURATION_ERROR)
 * @property {string} reason - Motivo del estado
 * @property {string} provider - Proveedor externo (NUBEFACT)
 */

/**
 * Módulo aislado de Facturación Electrónica (Nubefact).
 * Fase 1: Sin implementación real ni conexión a internet.
 */

/**
 * Intenta emitir un comprobante.
 * 
 * @param {Object} comprobanteData - Datos del comprobante a emitir
 * @returns {Promise<IntegrationResult>}
 */
const emitirComprobante = async (comprobanteData) => {
  if (!config.nubefact.enabled) {
    return {
      status: 'SKIPPED',
      reason: 'INTEGRATION_DISABLED',
      provider: 'NUBEFACT'
    };
  }

  // Si está habilitado pero faltan credenciales o configuración básica
  if (!config.nubefact.apiUrl || !config.nubefact.token) {
    return {
      status: 'CONFIGURATION_ERROR',
      reason: 'MISSING_CREDENTIALS_OR_URL',
      provider: 'NUBEFACT'
    };
  }

  // FASE 1: Sin contrato oficial implementado.
  return {
    status: 'NOT_IMPLEMENTED',
    reason: 'PROVIDER_CONTRACT_PENDING',
    provider: 'NUBEFACT'
  };
};

module.exports = {
  emitirComprobante
};
