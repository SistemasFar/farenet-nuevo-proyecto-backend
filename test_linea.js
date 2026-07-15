const LineaService = require('./services/linea.service');
const ValidarEtapaService = require('./services/validar_etapa.service');
const db = require('./db/db');

async function test() {
  try {
    const data = await LineaService.getWizardModel('INS-201-000158749');
    console.log(JSON.stringify(data.recibidas, null, 2));
    
    // Also test getTipo
    const getTipo = (item) => String(
      item.tipo_maquina_key ??
      item.tipomaquina_key ??
      item.tipomaquina?.key ??
      item.tipoMaquinaKey ??
      ''
    );
    
    console.log("Tipos:");
    data.recibidas.forEach(r => console.log(getTipo(r)));
  } catch (err) {
    console.error(err);
  } finally {
    db.pool.end();
  }
}
test();
