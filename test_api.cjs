const http = require('http');

async function doFetch(path, method, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : '';
    const options = {
      hostname: 'localhost',
      port: 3000,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    };
    if (token) options.headers['Authorization'] = 'Bearer ' + token;

    const req = http.request(options, res => {
      let resBody = '';
      res.on('data', chunk => { resBody += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(resBody) });
        } catch(e) {
          resolve({ status: res.statusCode, body: resBody });
        }
      });
    });

    req.on('error', e => reject(e));
    if (body) req.write(data);
    req.end();
  });
}

async function test() {
  try {
    console.log('--- TEST LOGIN ---');
    const loginRes = await doFetch('/api/faregas/auth/login', 'POST', { username: 'gibarra', password: '123' });
    console.log('Login Status:', loginRes.status);
    if (!loginRes.body.preToken) {
        console.log('NOTE: Since we do not know the real password, we cannot fully authenticate via HTTP. Skipping full flow, but we proved the endpoint is alive.');
        return;
    }
    
    console.log('--- TEST CONFIRMAR PLANTA ---');
    const confRes = await doFetch('/api/faregas/auth/confirmar-planta', 'POST', { plantaKey: 'VILLA' }, loginRes.body.preToken);
    console.log('Confirm Status:', confRes.status);
    
    if (!confRes.body.accessToken) return;

    console.log('--- TEST USUARIOS ---');
    const usuRes = await doFetch('/api/faregas/usuarios', 'GET', null, confRes.body.accessToken);
    console.log('Usuarios Status:', usuRes.status);
    console.log('Usuarios Encontrados:', usuRes.body.length);
  } catch (e) {
    console.error(e);
  }
}
test();
