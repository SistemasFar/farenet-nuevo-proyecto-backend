const pool = require('./config/database');
const crypto = require('crypto');

async function injectCupones() {
  try {
    const descuentoId = '17926942'; // ID de Cuponidad original
    // Obtenemos un descuentodetalle_id asociado (probablemente el FLA de livianos)
    const res = await pool.query(`SELECT id FROM descuentodetalle WHERE descuento_id = $1 LIMIT 1`, [descuentoId]);
    if (res.rows.length === 0) {
      console.log('No descuentodetalle found');
      return;
    }
    const detalleId = res.rows[0].id;
    
    // Obtenemos el max ID para incrementarlo manualmente
    const maxRes = await pool.query(`SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM descuentocliente`);
    let nextId = parseInt(maxRes.rows[0].next_id);
    
    // Generar 3 códigos de prueba realistas (UUID v4)
    const codes = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
    
    for (const code of codes) {
      await pool.query(`
        INSERT INTO descuentocliente (id, descuentodetalle_id, uuid, placa)
        VALUES ($1, $2, $3, NULL)
      `, [nextId++, detalleId, code]);
      console.log('Injected:', code);
    }
    
    console.log('Listo. Prueba con cualquiera de estos códigos.');
  } catch (e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
}
injectCupones();
