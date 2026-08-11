const db = require('./config/database.js');
const orquestadorService = require('./modules/orquestador/orquestador.service.js');
const faregasAuthService = require('./modules/faregas/auth/faregas-auth.service.js');

async function run() {
  try {
    const fNet = await orquestadorService.validarFarenetReadOnly('gibarra', '123456');
    console.log('Farenet Result (123456):', fNet);
    
    const fGas = await faregasAuthService.validarFaregas('gibarra', '123456');
    console.log('Faregas Result (123456):', fGas);
    
  } catch (e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
}
run();
