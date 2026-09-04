const cron = require('node-cron');
const pool = require('./config/database');
const { reconciliarPendientesSunat } = require('./modules/faregas/services/faregas-nubefact-cron.service');

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
    console.log('[CRON] Iniciando reconciliador SUNAT...', new Date().toLocaleString());
    await reconciliarPendientesSunat();
    console.log('[CRON] Reconciliador SUNAT finalizado.');
  });
};

module.exports = { startCronJobs };