const http = require('http');

const PORT = process.env.PORT || 3000;

async function testEndpoint(nro) {
  return new Promise((resolve) => {
    const url = `http://127.0.0.1:${PORT}/api/linea/pruebas-obligatorias/${nro}`;
    http.get(url, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          data: JSON.parse(body)
        });
      });
    }).on('error', (e) => {
      console.error(e.message);
      resolve(null);
    });
  });
}

// Para testear, buscaremos vehiculos en BD con distintos casos
const pool = require('./config/database');

async function runTests() {
  console.log('Running tests for Tarea 6...');
  const c = await pool.connect();
  
  const queryBase = `
    SELECT i.nrodocumentoinspeccion, comb.nombre as comb, c.nombre as cat, v.pesobruto 
    FROM inspeccion i 
    JOIN vehiculo v ON i.vehiculo_nromotor=v.nromotor 
    JOIN combustible comb ON v.combustible_key=comb.key
    JOIN categoria c ON v.categoria_key=c.key
    LIMIT 1
  `;

  // Helper to fetch one matching inspection
  async function findInsp(condition) {
    const res = await c.query(queryBase.replace('LIMIT 1', `WHERE ${condition} ORDER BY i.fechcreacion DESC LIMIT 1`));
    return res.rows[0];
  }

  // Caso 1 - Gasolina/GNV
  const c1 = await findInsp("comb.key NOT IN ('3', '5', '34', '10')");
  // Caso 2 - Diesel/Petroleo
  const c2 = await findInsp("comb.key IN ('3', '5')");
  // Caso 3 - Carreta
  const c3 = await findInsp("c.key IN ('O2', 'O3', 'O4')");
  // Caso 4 - Moto
  const c4 = await findInsp("c.key IN ('L1', 'L3')");
  // Caso 5 - Normal
  const c5 = await findInsp("c.key NOT IN ('O2','O3','O4','L1','L2','L3','L4','L5') AND v.pesobruto <= 3500");

  const casos = [
    { name: 'Caso 1: Gasolina/GNV', obj: c1 },
    { name: 'Caso 2: Diesel/Petroleo', obj: c2 },
    { name: 'Caso 3: Carreta', obj: c3 },
    { name: 'Caso 4: Moto', obj: c4 },
    { name: 'Caso 5: Normal completo', obj: c5 }
  ];

  for (const caso of casos) {
    console.log(`\n=== ${caso.name} ===`);
    if (caso.obj) {
      console.log(`Combustible: ${caso.obj.comb}, Categoria: ${caso.obj.cat}`);
      const res = await testEndpoint(caso.obj.nrodocumentoinspeccion);
      console.log(`Status: ${res.status}`);
      console.log('Obligatorias:', res.data.obligatorias.map(o => o.nombre).join(', '));
      console.log('No Aplicables:', res.data.noAplicables.map(o => o.nombre).join(', '));
    } else {
      console.log(`No se encontró vehículo para este caso en la BD de prueba.`);
    }
  }

  c.release();
  process.exit(0);
}

runTests();
