const service = require('./services/inspecciones_proceso.service.js');
service.obtenerProceso('INS-201-000160316')
  .then(res => console.log(JSON.stringify(res, null, 2)))
  .catch(err => console.error(err))
  .finally(() => process.exit(0));
