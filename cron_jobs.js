const cron = require('node-cron');
const pool = require('./config/database');
const { reconciliarPendientesSunat } = require('./modules/faregas/services/faregas-nubefact-cron.service');
const { reconciliarNotasPendientesSunat } = require('./modules/faregas/services/faregas-nubefact-notas-cron.service');
const notasCreditoWorker = require('./modules/faregas/services/faregas-notas-credito-worker.service');
const { reconciliarAnulacionesPendientes } = require('./modules/faregas/services/faregas-solicitudes-operacion.service');

let reconciliacionAnulacionesEnCurso = false;
let emisionNotasEnCurso = false;
let cronContingencia = null;
let tareasCronRegistradas = [];

/**
 * Evalúa si las tareas automáticas (CRON) están habilitadas globalmente.
 * Requiere explícitamente FAREGAS_CRON_ENABLED='true'.
 * Cualquier otro valor (false, 0, vacío, undefined, etc.) desactiva todos los CRON.
 */
const esCronHabilitado = () => {
  const valor = String(process.env.FAREGAS_CRON_ENABLED ?? '').trim().toLowerCase();
  return valor === 'true';
};

const stopCronJobs = () => {
  for (const tarea of tareasCronRegistradas) {
    if (tarea && typeof tarea.stop === 'function') {
      try { tarea.stop(); } catch (_) { /* sin acción */ }
    }
  }
  tareasCronRegistradas = [];
  if (cronContingencia && typeof cronContingencia.stop === 'function') {
    try { cronContingencia.stop(); } catch (_) { /* sin acción */ }
  }
  cronContingencia = null;
  reconciliacionAnulacionesEnCurso = false;
  emisionNotasEnCurso = false;
};

const obtenerEstadoCronJobs = () => {
  return {
    habilitado: esCronHabilitado(),
    tareasRegistradas: tareasCronRegistradas.length + (cronContingencia ? 1 : 0),
    emisionNotasEnCurso,
    reconciliacionAnulacionesEnCurso
  };
};

const startCronJobs = () => {
  // Punto central de protección: Si no está explícitamente en 'true', se bloquean todos los CRON.
  if (!esCronHabilitado()) {
    console.log('[CRON FAREGAS] Tareas automáticas deshabilitadas globalmente (FAREGAS_CRON_ENABLED != "true").');
    stopCronJobs();
    return {
      habilitado: false,
      tareasRegistradas: 0
    };
  }

  console.log('[CRON FAREGAS] Tareas automáticas habilitadas explícitamente (FAREGAS_CRON_ENABLED="true").');

  // Limpiar instancias previas antes de volver a registrar
  stopCronJobs();

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
  const tareaNotas = cron.schedule('* * * * *', async () => {
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
  tareasCronRegistradas.push(tareaNotas);

  // Reconciliación SUNAT cada 10 minutos
  const tareaReconciliacion = cron.schedule('*/10 * * * *', async () => {
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
  tareasCronRegistradas.push(tareaReconciliacion);

  return {
    habilitado: true,
    tareasRegistradas: tareasCronRegistradas.length + (cronContingencia ? 1 : 0)
  };
};

module.exports = {
  startCronJobs,
  stopCronJobs,
  esCronHabilitado,
  obtenerEstadoCronJobs
};
