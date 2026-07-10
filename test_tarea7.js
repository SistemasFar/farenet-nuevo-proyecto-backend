const http = require('http');

const PORT = process.env.PORT || 3000;
const pool = require('./config/database');

function postData(url, data) {
  return new Promise((resolve) => {
    const postData = JSON.stringify(data);
    const req = http.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          data: JSON.parse(body)
        });
      });
    });
    req.on('error', (e) => resolve({status: 500, error: e.message}));
    req.write(postData);
    req.end();
  });
}

async function getEstado(nro) {
  return new Promise((resolve) => {
    http.get(`http://127.0.0.1:${PORT}/api/linea/estado/${nro}`, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve(JSON.parse(body)));
    });
  });
}

async function runTests() {
  console.log('Running tests for Tarea 7...');
  const c = await pool.connect();
  
  // Encontremos una inspeccion de prueba en estado posicion=5
  // Para pruebas, forzamos una en BD (o usamos una que este en 5, o forzamos un update local si se necesita para test, pero el usuario dijo: "No hacer UPDATE manual de BD sin autorización... Si necesitas preparar data especial, pedir autorizacion". 
  // Voy a buscar una q este en 5 o entre 5 y 13.
  const resInsp = await c.query("SELECT nrodocumentoinspeccion, posicion FROM inspeccion WHERE nrodocumentoinspeccion='INS-98-000630100'");
  
  if (resInsp.rows.length === 0) {
    console.log('No hay inspecciones en posicion 5-13. Buscando cualquiera e imprimiendo estado.');
    // Si no hay, busco cualquier inspeccion solo para imprimir su estado
    const resC = await c.query("SELECT nrodocumentoinspeccion FROM inspeccion LIMIT 1");
    if (resC.rows.length > 0) {
      console.log('Inspeccion:', resC.rows[0].nrodocumentoinspeccion);
      const est = await getEstado(resC.rows[0].nrodocumentoinspeccion);
      console.log('Estado:', est);
    }
    c.release();
    process.exit(0);
    return;
  }
  
  const nro = resInsp.rows[0].nrodocumentoinspeccion;
  console.log('Usando inspeccion:', nro);
  
  const estadoBase = await getEstado(nro);
  console.log(`Estado Inicial. Posicion: ${estadoBase.posicionActual}, Faltan: ${estadoBase.faltantes.length}`);

  if (estadoBase.faltantes.length === 0) {
    console.log('Ya tiene todas las pruebas completas, no se puede hacer el caso de prueba 1 y 2 propiamente desde cero.');
  } else {
    // Tomamos la primera maquina faltante para simular que la pasamos
    const maqIdReq = await c.query("SELECT id FROM maquina WHERE tipomaquina_key = $1 LIMIT 1", [estadoBase.faltantes[0].tipomaquinaKey]);
    
    if (maqIdReq.rows.length > 0) {
      const payload1 = {
        nroInspeccion: nro,
        resultadoMaquina: {
          maquina: { id: maqIdReq.rows[0].id },
          resultado: 'A'
        }
      };
      console.log('\n--- CASO 1: Incompleto ---');
      const r1 = await postData(`http://127.0.0.1:${PORT}/api/linea/appresultado`, payload1);
      console.log(`Status: ${r1.status}`);
      console.log(`Posicion: ${r1.data.posicionActual} (Debe mantenerse), EtapaCompleta: ${r1.data.etapaCompleta}, Faltantes: ${r1.data.faltantes.length}`);
      
      console.log('\n--- CASO 5: Reemplazo con D ---');
      payload1.resultadoMaquina.resultado = 'D';
      const r5 = await postData(`http://127.0.0.1:${PORT}/api/linea/appresultado`, payload1);
      console.log(`Status: ${r5.status}`);
      console.log(`Reemplazo: ${r5.data.reemplazoAnterior}, ResultadoPreliminar: ${r5.data.resultadoPreliminar}`);
      
      // Chequear BD para ver duplicados
      const resDup = await c.query("SELECT maquina_id, count(*) FROM resultado_maquina WHERE inspeccion_nrodocumentoinspeccion=$1 GROUP BY maquina_id HAVING count(*) > 1", [nro]);
      console.log(`Duplicados en BD: ${resDup.rows.length}`);
      
      console.log('\n--- CASO 2 y 3: Completando el resto ---');
      let statusActual = r5.data;
      while(statusActual.faltantes && statusActual.faltantes.length > 0) {
        const reqq = statusActual.faltantes[0];
        const m = await c.query("SELECT id FROM maquina WHERE tipomaquina_key = $1 LIMIT 1", [reqq.tipomaquinaKey]);
        if(m.rows.length > 0) {
           const p = { nroInspeccion: nro, resultadoMaquina: { maquina: { id: m.rows[0].id }, resultado: 'A' } };
           const rp = await postData(`http://127.0.0.1:${PORT}/api/linea/appresultado`, p);
           statusActual = rp.data;
           console.log(`Enviado ${reqq.nombre}, Posicion: ${statusActual.posicionActual}, Faltantes: ${statusActual.faltantes.length}`);
        } else {
           console.log(`No hay maquina para ${reqq.nombre}`);
           break;
        }
      }
      
      console.log('\n--- RESULTADO FINAL DE COMPLETADO ---');
      console.log(`Posicion Actual: ${statusActual.posicionActual} (Debe ser 14)`);
      console.log(`Resultado Preliminar: ${statusActual.resultadoPreliminar} (Debe ser D por el reemplazo previo)`);
      console.log(`Etapa Completa: ${statusActual.etapaCompleta}`);
      
      console.log('\n--- CASO 6: Enviar de nuevo en 14 ---');
      const r6 = await postData(`http://127.0.0.1:${PORT}/api/linea/appresultado`, payload1);
      console.log(`Status: ${r6.status}`);
      console.log(`Mensaje: ${r6.data.mensaje}`);
    }
  }

  c.release();
  process.exit(0);
}

runTests();
