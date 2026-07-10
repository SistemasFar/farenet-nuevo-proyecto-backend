const http = require('http');

const PORT = process.env.PORT || 3000;
const URL_API = `http://127.0.0.1:${PORT}/api/linea/appresultado`;
const { Pool } = require('pg');
// Connect to DB directly in test script to verify state
const pool = require('./config/database'); // Use existing config

async function postRequest(name, url, payload) {
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
        resolve(JSON.parse(body));
      });
    });
    req.on('error', (e) => {
      console.error(`Problem with request: ${e.message}`);
      resolve(null);
    });
    req.write(data);
    req.end();
  });
}

async function verifyDB(nroInspeccion, maquinaId) {
  const c = await pool.connect();
  const res = await c.query(`
    SELECT
      inspeccion_nrodocumentoinspeccion,
      maquina_id,
      COUNT(*) AS cantidad
    FROM resultado_maquina
    WHERE inspeccion_nrodocumentoinspeccion = $1
      AND maquina_id = $2
    GROUP BY inspeccion_nrodocumentoinspeccion, maquina_id;
  `, [nroInspeccion, maquinaId]);
  
  if (res.rows.length > 0) {
    console.log(`[DB Verify] Duplicados?: cantidad = ${res.rows[0].cantidad}`);
    
    // Check defects
    const defRes = await c.query(`
      SELECT d.defectos_id 
      FROM resultado_maquina rm
      JOIN resultado_maquina_defecto d ON d.resultado_maquina_id = rm.id
      WHERE rm.inspeccion_nrodocumentoinspeccion = $1 AND rm.maquina_id = $2
    `, [nroInspeccion, maquinaId]);
    console.log(`[DB Verify] Defectos insertados:`, defRes.rows.map(r => r.defectos_id));
  } else {
    console.log(`[DB Verify] Sin registros.`);
  }
  c.release();
}

async function cleanDB(nroInspeccion, maquinaId) {
  const c = await pool.connect();
  const previo = await c.query('SELECT id FROM resultado_maquina WHERE inspeccion_nrodocumentoinspeccion=$1 AND maquina_id=$2', [nroInspeccion, maquinaId]);
  if (previo.rows.length > 0) {
    for (const row of previo.rows) {
      await c.query('DELETE FROM resultado_maquina_defecto WHERE resultado_maquina_id = $1', [row.id]);
      await c.query('DELETE FROM resultado_maquina WHERE id = $1', [row.id]);
    }
  }
  c.release();
}

async function runTests() {
  console.log('Running UPSERT tests...');
  const nro = 'INS-201-000160202';
  const maquinaId = 137227;

  // Limpiar antes de empezar
  await cleanDB(nro, maquinaId);

  // Caso 1 - Insert nuevo sin defectos
  await postRequest('Caso 1: Insert nuevo', URL_API, {
    nroInspeccion: nro,
    resultadoMaquina: {
      maquina: { id: maquinaId },
      resultado: 'A'
    }
  });
  await verifyDB(nro, maquinaId);

  // Caso 2 - Reemplazo
  await postRequest('Caso 2: Reemplazo', URL_API, {
    nroInspeccion: nro,
    resultadoMaquina: {
      maquina: { id: maquinaId },
      resultado: 'A'
    }
  });
  await verifyDB(nro, maquinaId);

  // Caso 3A - Insertar con defectos
  // Find a valid defect ID from DB to test. Let's assume defect 1 and 2 exist (from defecto table)
  // Need to get real defect IDs. I'll just query 2 real IDs.
  const c = await pool.connect();
  const defs = await c.query('SELECT id FROM defecto LIMIT 2');
  const d1 = defs.rows[0].id;
  const d2 = defs.rows[1].id;
  c.release();

  await postRequest('Caso 3A: Con 2 defectos', URL_API, {
    nroInspeccion: nro,
    resultadoMaquina: {
      maquina: { id: maquinaId },
      resultado: 'D',
      defectos: [ { id: d1 }, { id: d2 } ]
    }
  });
  await verifyDB(nro, maquinaId);

  // Caso 3B - Reemplazar con 1 defecto distinto
  const c2 = await pool.connect();
  const defs3 = await c2.query('SELECT id FROM defecto LIMIT 3');
  const d3 = defs3.rows[2].id;
  c2.release();

  await postRequest('Caso 3B: Reemplazar defectos (solo 1 nuevo)', URL_API, {
    nroInspeccion: nro,
    resultadoMaquina: {
      maquina: { id: maquinaId },
      resultado: 'D',
      defectos: [ { id: d3 } ]
    }
  });
  await verifyDB(nro, maquinaId);

  console.log('\nFinalizado.');
  process.exit(0);
}

runTests();
