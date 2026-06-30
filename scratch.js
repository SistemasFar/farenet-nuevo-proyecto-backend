const pool = require('./config/database');
async function run() {
  try {
    const ts = Date.now();
    const dId = ts;
    await pool.query("INSERT INTO descuento (id, empresa_nrodocumentoidentidad, nombre, estado, fechinicio, fechfin) VALUES ($1, '20543666666', 'Campaña Primavera 2026 (SQL Real)', true, CURRENT_DATE - INTERVAL '1 day', CURRENT_DATE + INTERVAL '30 days')", [dId]);
    const ddId = ts;
    await pool.query("INSERT INTO descuentodetalle (id, descuento_id, conceptoinspeccion_key, monto) VALUES ($1, $2, 'AMBULANCIA', 20.00)", [ddId, dId]);
    const dcId = ts;
    await pool.query("INSERT INTO descuentocliente (id, descuentodetalle_id, placa, estado) VALUES ($1, $2, 'DSC-123', true)", [dcId, ddId]);
    console.log('¡Datos reales inyectados con exito!');
  } catch (e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
}
run();
