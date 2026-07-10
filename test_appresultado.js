const http = require('http');

const PORT = process.env.PORT || 3000;
const URL_API = `http://127.0.0.1:${PORT}/api/linea/appresultado`;
const URL_LEGACY = `http://127.0.0.1:${PORT}/linea/appresultado`;

async function test(name, url, payload) {
  return new Promise((resolve) => {
    const data = JSON.stringify(payload);
    const req = http.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        console.log(`\n=== ${name} ===`);
        console.log(`Status: ${res.statusCode}`);
        console.log(`Response:`, JSON.parse(body));
        resolve();
      });
    });
    req.on('error', (e) => {
      console.error(`Problem with request: ${e.message}`);
      resolve();
    });
    req.write(data);
    req.end();
  });
}

async function runTests() {
  console.log('Running tests...');
  
  // Create a valid inspection for testing or use an existing one.
  // Assuming 'INS-201-000160202' exists and is in pos 5 from previous chat.
  // Wait, the user said "Inspección en posicion = 5, máquina existente"
  // Let's use a mock inspection if needed, but we'll just try an existing one first.
  
  // We need an existing machine. We saw 137227 in the DB dump.
  
  // Caso 1 - OK (con URL nueva /api/linea/...)
  await test('Caso 1: OK (URL /api/linea/appresultado)', URL_API, {
    nroInspeccion: 'INS-201-000160202', // Change if this one is not pos 5
    resultadoMaquina: {
      maquina: { id: 137227 },
      resultado: 'A'
    }
  });

  // Caso 1B - OK (con URL legacy /linea/...)
  await test('Caso 1B: OK (URL legacy /linea/appresultado)', URL_LEGACY, {
    nroInspeccion: 'INS-201-000160202', 
    resultadoMaquina: {
      maquina: { id: 137227 },
      resultado: 'A'
    }
  });

  // Caso 2 - Inexistente
  await test('Caso 2: Inspeccion no existe', URL_API, {
    nroInspeccion: 'INS-999-000000',
    resultadoMaquina: {
      maquina: { id: 137227 },
      resultado: 'A'
    }
  });

  // Caso 6 - Máquina no existe
  await test('Caso 6: Máquina no existe', URL_API, {
    nroInspeccion: 'INS-201-000160202',
    resultadoMaquina: {
      maquina: { id: 999999999 },
      resultado: 'A'
    }
  });

  // Caso 7 - Resultado inválido
  await test('Caso 7: Resultado inválido', URL_API, {
    nroInspeccion: 'INS-201-000160202',
    resultadoMaquina: {
      maquina: { id: 137227 },
      resultado: 'X'
    }
  });
}

runTests();
