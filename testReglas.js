const { evaluarDefectosTecnicos } = require('./services/reglasEvaluacion.service.js');
evaluarDefectosTecnicos('INS-201-000157504').then(res => {
   console.log('Result:', res);
   process.exit(0);
}).catch(console.error);
