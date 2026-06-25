const pool = require('./config/database');

async function seedDescuento() {
  try {
    const ruc = '99999999999';
    const monto = 50.00;
    
    // 1. Crear el descuento (Campaña)
    // El id es un string en esta tabla usualmente, o un serial. Veremos si genera error
    const descId = Math.floor(Math.random() * 1000000).toString();
    await pool.query(`
      INSERT INTO descuento (id, nombre, empresa_nrodocumentoidentidad, estado)
      VALUES ($1, $2, $3, $4)
    `, [descId, 'PROMO PRUEBA SUPER DESCUENTO', ruc, true]);

    // 2. Obtener todos los conceptos
    const conceptosRes = await pool.query('SELECT key FROM conceptoinspeccion');
    
    // 3. Insertar detalle de descuento para TODOS los conceptos
    for (const c of conceptosRes.rows) {
      const ddId = Math.floor(Math.random() * 1000000).toString();
      await pool.query(`
        INSERT INTO descuentodetalle (id, monto, descuento_id, conceptoinspeccion_key)
        VALUES ($1, $2, $3, $4)
      `, [ddId, monto, descId, c.key]);
    }
    
    console.log(`✅ ¡Descuento de S/ 50.00 insertado para el RUC ${ruc} aplicable a TODOS los conceptos!`);
  } catch (error) {
    console.error('Error insertando:', error);
  } finally {
    process.exit(0);
  }
}

seedDescuento();
