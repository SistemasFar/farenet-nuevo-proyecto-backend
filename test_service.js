const LineaService = require('./services/linea.service');

async function runTests() {
  console.log('Running direct tests on LineaService...\n');
  
  const pool = require('./config/database');
  const client = await pool.connect();
  await client.query("UPDATE inspeccion SET posicion=5 WHERE nrodocumentoinspeccion='INS-201-000160202'");
  client.release();
  
  async function test(name, payload) {
    try {
      const res = await LineaService.recibirResultadoBase(payload);
      console.log(`=== ${name} ===`);
      console.log('Status: OK');
      console.log(res);
    } catch (e) {
      console.log(`=== ${name} ===`);
      console.log('Status: ERROR');
      console.log(e.message);
    }
    console.log('');
  }

  // Caso 1 - OK
  await test('Caso 1: OK', {
    nroInspeccion: 'INS-201-000160202', // Change if this one is not pos 5
    resultadoMaquina: {
      maquina: { id: 137227 },
      resultado: 'A'
    }
  });

  // Caso 2 - Inexistente
  await test('Caso 2: Inspeccion no existe', {
    nroInspeccion: 'INS-999-000000',
    resultadoMaquina: {
      maquina: { id: 137227 },
      resultado: 'A'
    }
  });

  // Caso 6 - Máquina no existe
  await test('Caso 6: Máquina no existe', {
    nroInspeccion: 'INS-201-000160202',
    resultadoMaquina: {
      maquina: { id: 999999999 },
      resultado: 'A'
    }
  });

  // Caso 7 - Resultado inválido
  await test('Caso 7: Resultado inválido', {
    nroInspeccion: 'INS-201-000160202',
    resultadoMaquina: {
      maquina: { id: 137227 },
      resultado: 'X'
    }
  });
  
  process.exit(0);
}

runTests();
