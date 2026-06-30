const pool = require('./config/database');

async function run() {
  try {
    const ts = Date.now();
    const conceptoAmbulancia = '30';
    const dniUsuario = '74045610';
    const rucUsuario = '20543666666';

    console.log('Iniciando inyección de Descuentos...');

    // Crear descuento Tipo 1 (Directo DNI)
    const idDni = ts + 1;
    await pool.query("INSERT INTO descuento (id, empresa_nrodocumentoidentidad, nombre, estado, fechinicio, fechfin) VALUES ($1, $2, 'Campaña Primavera DNI (S/ 12)', true, CURRENT_DATE - INTERVAL '1 day', CURRENT_DATE + INTERVAL '30 days')", [idDni, dniUsuario]);
    await pool.query("INSERT INTO descuentodetalle (id, descuento_id, conceptoinspeccion_key, monto) VALUES ($1, $2, $3, 12.00)", [ts + 2, idDni, conceptoAmbulancia]);

    // Crear descuento Tipo 3 (Masivo RUC)
    const idRuc = ts + 3;
    await pool.query("INSERT INTO descuentomasivo (id, empresa_nrodocumentoidentidad, nombre, estado, fechinicio, fechfin) VALUES ($1, $2, 'Mega Flota Corporativa (S/ 30)', true, CURRENT_DATE - INTERVAL '1 day', CURRENT_DATE + INTERVAL '30 days')", [idRuc, rucUsuario]);
    await pool.query("INSERT INTO descuentomasivodetalle (id, descuentomasivo_id, conceptoinspeccion_key, monto) VALUES ($1, $2, $3, 30.00)", [ts + 4, idRuc, conceptoAmbulancia]);

    console.log('¡Descuentos inyectados!');
  } catch (e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
}

run();
