const pool = require('./config/database');
(async () => {
  try {
    const ruc = '20202020202';
    const idDesc = Math.floor(Math.random() * 1000000).toString();
    
    // Crear campaña válida por 30 días
    await pool.query(`
      INSERT INTO descuento (id, nombre, empresa_nrodocumentoidentidad, estado, fechinicio, fechfin)
      VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP - interval '1 day', CURRENT_TIMESTAMP + interval '30 days')
    `, [idDesc, 'PROMO NUEVA VALIDADA (S/ 50.00)', ruc, true]);
    
    const conceptosRes = await pool.query('SELECT key FROM conceptoinspeccion');
    for (const c of conceptosRes.rows) {
      const ddId = Math.floor(Math.random() * 1000000).toString();
      await pool.query(`
        INSERT INTO descuentodetalle (id, monto, descuento_id, conceptoinspeccion_key)
        VALUES ($1, $2, $3, $4)
      `, [ddId, 50.00, idDesc, c.key]);
    }
    console.log('✅ Descuento Creado: RUC 20202020202 con vigencia de 30 días');
  } catch (e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
})();
