const controller = require('./controllers/inspecciones.controller');
const req = {
  body: { placa: 'TEST01', concepto: '213', categoria: 'L1', tipoInspeccion: '3', tipoCertificado: '2', tipoAutorizacion: '6', plantaKey: '203' }
};
const res = {
  status: function(code) { this.statusCode = code; return this; },
  json: function(data) { console.log(JSON.stringify(data, null, 2)); process.exit(0); }
};
controller.consultarVehiculoYCaja(req, res);
