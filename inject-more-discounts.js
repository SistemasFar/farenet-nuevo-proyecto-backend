const pool = require('./config/database');

async function run() {
  try {
    const ts = Date.now();
    const conceptoAmbulancia = '30';

    // TIPO 1: Descuento directo por DNI/RUC (Usaremos DSC-123 como si fuera un DNI/RUC para que aparezca)
    const id1 = ts + 1;
    await pool.query("INSERT INTO descuento (id, empresa_nrodocumentoidentidad, nombre, estado, fechinicio, fechfin) VALUES ($1, 'DSC-123', 'Campaña Corporativa (DNI/RUC)', true, CURRENT_DATE - INTERVAL '1 day', CURRENT_DATE + INTERVAL '30 days')", [id1]);
    const ddId1 = ts + 2;
    await pool.query("INSERT INTO descuentodetalle (id, descuento_id, conceptoinspeccion_key, monto) VALUES ($1, $2, $3, 10.00)", [ddId1, id1, conceptoAmbulancia]);

    // TIPO 3: Descuento Masivo por DNI/RUC (Igual, usaremos DSC-123 como DNI/RUC)
    const id3 = ts + 3;
    await pool.query("INSERT INTO descuentomasivo (id, empresa_nrodocumentoidentidad, nombre, estado, fechinicio, fechfin) VALUES ($1, 'DSC-123', 'Campaña Flotas Masiva (DNI/RUC)', true, CURRENT_DATE - INTERVAL '1 day', CURRENT_DATE + INTERVAL '30 days')", [id3]);
    const dmdId3 = ts + 4;
    await pool.query("INSERT INTO descuentomasivodetalle (id, descuentomasivo_id, conceptoinspeccion_key, monto) VALUES ($1, $2, $3, 15.00)", [dmdId3, id3, conceptoAmbulancia]);

    // TIPO 4: Descuento Masivo por Placa/Código
    const id4 = ts + 5;
    await pool.query("INSERT INTO descuentomasivo (id, empresa_nrodocumentoidentidad, nombre, estado, fechinicio, fechfin) VALUES ($1, '999999999', 'Campaña Cuponera Masiva (Placa)', true, CURRENT_DATE - INTERVAL '1 day', CURRENT_DATE + INTERVAL '30 days')", [id4]);
    const dmdId4 = ts + 6;
    await pool.query("INSERT INTO descuentomasivodetalle (id, descuentomasivo_id, conceptoinspeccion_key, monto) VALUES ($1, $2, $3, 25.00)", [dmdId4, id4, conceptoAmbulancia]);
    const dmcId4 = ts + 7;
    await pool.query("INSERT INTO descuentomasivocliente (id, descuentomasivo_id, placa, estado) VALUES ($1, $2, 'DSC-123', true)", [dmcId4, id4]);

    console.log('¡Todos los tipos de descuentos fueron inyectados con exito!');
  } catch (e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
}

run();
