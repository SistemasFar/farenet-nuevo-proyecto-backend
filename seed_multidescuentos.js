const pool = require('./config/database');

async function seedMulti() {
  try {
    const conceptosRes = await pool.query('SELECT key FROM conceptoinspeccion');
    if (conceptosRes.rows.length === 0) throw new Error("No hay conceptos en la BD");

    // Elegimos el primer concepto para la prueba (para que sea universal, le meteremos a TODOS)
    // O mejor lo metemos a todos los conceptos para no fallar.
    
    console.log("Iniciando inserción de datos de prueba para Código, DNI/RUC y Placa...");

    // 1. DNI/RUC
    const descRucId = Math.floor(Math.random() * 1000000).toString();
    await pool.query(`INSERT INTO descuento (id, nombre, empresa_nrodocumentoidentidad, estado) VALUES ($1, $2, $3, $4)`, 
      [descRucId, 'PROMO DNI/RUC (S/ 10.00)', '10101010101', true]);

    // 2. PLACA
    const descPlacaId = Math.floor(Math.random() * 1000000).toString();
    await pool.query(`INSERT INTO descuento (id, nombre, empresa_nrodocumentoidentidad, estado) VALUES ($1, $2, $3, $4)`, 
      [descPlacaId, 'PROMO PLACA (S/ 20.00)', null, true]);

    // 3. CODIGO
    const descCodigoId = Math.floor(Math.random() * 1000000).toString();
    await pool.query(`INSERT INTO descuento (id, nombre, empresa_nrodocumentoidentidad, estado) VALUES ($1, $2, $3, $4)`, 
      [descCodigoId, 'PROMO CODIGO (S/ 30.00)', null, true]);

    // Insertar descuentodetalle para todos los conceptos y ligarlo a descuentocliente
    for (const c of conceptosRes.rows) {
      // Detalle RUC
      const ddRucId = Math.floor(Math.random() * 1000000).toString();
      await pool.query(`INSERT INTO descuentodetalle (id, monto, descuento_id, conceptoinspeccion_key) VALUES ($1, $2, $3, $4)`, 
        [ddRucId, 10.00, descRucId, c.key]);
      
      // Detalle PLACA
      const ddPlacaId = Math.floor(Math.random() * 1000000).toString();
      await pool.query(`INSERT INTO descuentodetalle (id, monto, descuento_id, conceptoinspeccion_key) VALUES ($1, $2, $3, $4)`, 
        [ddPlacaId, 20.00, descPlacaId, c.key]);
      
      // Cliente Placa
      const cliPlacaId = Math.floor(Math.random() * 1000000).toString();
      await pool.query(`INSERT INTO descuentocliente (id, descuentodetalle_id, placa, estado) VALUES ($1, $2, $3, $4)`,
        [cliPlacaId, ddPlacaId, 'ABC-123', true]);

      // Detalle CODIGO
      const ddCodigoId = Math.floor(Math.random() * 1000000).toString();
      await pool.query(`INSERT INTO descuentodetalle (id, monto, descuento_id, conceptoinspeccion_key) VALUES ($1, $2, $3, $4)`, 
        [ddCodigoId, 30.00, descCodigoId, c.key]);
        
      // Cliente Codigo
      const cliCodigoId = Math.floor(Math.random() * 1000000).toString();
      await pool.query(`INSERT INTO descuentocliente (id, descuentodetalle_id, uuid, estado) VALUES ($1, $2, $3, $4)`,
        [cliCodigoId, ddCodigoId, 'COD-PROMO-99', true]);
    }

    console.log("✅ Datos inyectados con éxito.");
    console.log("👉 Prueba 1: Ingresa '10101010101' (DNI/RUC) -> Mostrará S/ 10.00");
    console.log("👉 Prueba 2: Ingresa 'ABC-123' (Placa) -> Mostrará S/ 20.00");
    console.log("👉 Prueba 3: Ingresa 'COD-PROMO-99' (Código) -> Mostrará S/ 30.00");

  } catch (error) {
    console.error('Error insertando data:', error);
  } finally {
    process.exit(0);
  }
}

seedMulti();
