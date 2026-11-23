const cron = require('node-cron');
const pool = require('./config/database');
const { reconciliarPendientesSunat } = require('./modules/faregas/services/faregas-nubefact-cron.service');
const { reconciliarNotasPendientesSunat } = require('./modules/faregas/services/faregas-nubefact-notas-cron.service');
const notasCreditoWorker = require('./modules/faregas/services/faregas-notas-credito-worker.service');
const { reconciliarAnulacionesPendientes } = require('./modules/faregas/services/faregas-solicitudes-operacion.service');

let reconciliacionAnulacionesEnCurso = false;
let emisionNotasEnCurso = false;
let cronContingencia;

const startCronJobs = () => {
  const { contingencia } = require('./config/integrations.config');
  if (contingencia.habilitada && contingencia.cronHabilitado && !cronContingencia) {
    const worker = require('./modules/faregas/services/faregas-contingencia-worker.service');
    cronContingencia = cron.schedule('0 * * * *', async () => {
      try {
        const resultado = await worker.procesarLote();
        if (resultado.reclamados) console.log('[CRON FAREGAS CONTINGENCIA]', resultado);
      } catch (error) {
        console.error('[CRON FAREGAS CONTINGENCIA]', error.code || 'ERROR_INTERNO');
      }
    }, { noOverlap: true, timezone: 'America/Lima' });
  }

  // Recupera trabajos persistentes de notas de crédito después de un reinicio.
  cron.schedule('* * * * *', async () => {
    const integrationsConfig = require('./config/integrations.config');
    if (!integrationsConfig.nubefact.enabled
        || !integrationsConfig.nubefact.notasAutoEmissionEnabled
        || emisionNotasEnCurso) return;
    emisionNotasEnCurso = true;
    try {
      const resultado = await notasCreditoWorker.procesarPendientes();
      if (resultado.reclamados > 0) {
        console.log('[CRON] Trabajos de notas de crédito procesados.', resultado);
      }
    } catch (error) {
      console.error('[CRON] Fallo en la cola de notas de crédito:', error.message);
    } finally {
      emisionNotasEnCurso = false;
    }
  });

  // Reconciliación SUNAT cada 10 minutos
  cron.schedule('*/10 * * * *', async () => {
    const integrationsConfig = require('./config/integrations.config');
    if (integrationsConfig.nubefact.enabled
        && integrationsConfig.nubefact.cronReconciliationEnabled) {
      console.log('[CRON] Iniciando reconciliador SUNAT Facturas/Boletas...', new Date().toLocaleString());
      try {
        const resultado = await reconciliarPendientesSunat();
        console.log('[CRON] Reconciliador SUNAT Facturas/Boletas finalizado.', resultado);
      } catch (error) {
        console.error('[CRON] Fallo no controlado en reconciliador SUNAT Facturas/Boletas:', error.message);
      }

      if (!reconciliacionAnulacionesEnCurso) {
        reconciliacionAnulacionesEnCurso = true;
        console.log('[CRON] Iniciando reconciliador de anulaciones FAREGAS...', new Date().toLocaleString());
        try {
          const resultadoAnulaciones = await reconciliarAnulacionesPendientes();
          console.log('[CRON] Reconciliador de anulaciones FAREGAS finalizado.', resultadoAnulaciones);
        } catch (error) {
          console.error('[CRON] Fallo no controlado en reconciliador de anulaciones FAREGAS:', error.message);
        } finally {
          reconciliacionAnulacionesEnCurso = false;
        }
      }
    }

    if (integrationsConfig.nubefact.enabled
        && integrationsConfig.nubefact.notasCronReconciliationEnabled) {
      console.log('[CRON] Iniciando reconciliador SUNAT Notas de Credito...', new Date().toLocaleString());
      try {
        const resultadoNotas = await reconciliarNotasPendientesSunat();
        console.log('[CRON] Reconciliador SUNAT Notas de Credito finalizado.', resultadoNotas);
      } catch (error) {
        console.error('[CRON] Fallo no controlado en reconciliador SUNAT Notas de Credito:', error.message);
      }
    }
  });
};

module.exports = { startCronJobs };
