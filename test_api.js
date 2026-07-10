const http = require('http');

const data = JSON.stringify({
  ingenieroCertificadorUsername: 'ylucero',
  usuarioConsolidadorUsername: 'dbrito',
  observacion: 'Prueba caso A'
});

const options = {
  hostname: '127.0.0.1',
  port: 3000,
  path: '/api/linea/consolidacion/INS-102-TEST-CASO-A/guardar',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length
  }
};

const req = http.request(options, (res) => {
  console.log(`STATUS: ${res.statusCode}`);
  res.setEncoding('utf8');
  res.on('data', (chunk) => {
    console.log(`BODY: ${chunk}`);
  });
});

req.on('error', (e) => {
  console.error(`problem with request: ${e.message}`);
});

req.write(data);
req.end();
