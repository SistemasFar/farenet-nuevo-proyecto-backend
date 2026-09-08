const cron = require('node-cron');
const pool = require('./config/database');
const { reconciliarPendientesSunat } = require('./modules/faregas/services/faregas-nubefact-cron.service');
const { reconciliarNotasPendientesSunat } = require('./modules/faregas/services/faregas-nubefact-notas-cron.service');

// Se ejecuta todos los d�as a las 3:00 AM
const startCronJobs = () => {
  cron.schedule('0 3 * * *', async () => {
    console.log('[CRON] Iniciando recolector de basura de borradores...', new Date().toLocaleString());
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      // Buscar inspecciones en PROCESO  que tengan m�s de 24 horas y anularlas (ANU) o eliminarlas.
      // Para replicar el comportamiento antiguo limpio, las marcaremos como ANU.
      const updateInspecciones = await client.query(`
        UPDATE inspeccion 
        SET inspeccionestado_key = 'ANU', fechmodi = NOW()
        WHERE inspeccionestado_key = 'PROCESO' 
          AND fechcreacion < NOW() - INTERVAL '1 day'
      `);
      console.log(`[CRON] ${updateInspecciones.rowCount} inspecciones hu�rfanas en PROCESO marcadas como ANULADAS.`);

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('[CRON] Error ejecutando recolector de basura:', err);
    } finally {
      client.release();
    }
    console.log('[CRON] Recolector de basura finalizado.');
  });

  // Se ejecuta cada 10 minutos
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
    }

    // Las notas de crédito se habilitan de manera independiente para que activar
    // Facturas/Boletas no ponga en marcha accidentalmente un flujo aún no liberado.
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
