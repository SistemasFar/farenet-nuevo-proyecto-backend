const http = require('http');

const data = JSON.stringify({
  username: 'mchavez',
  password: '123'
});

const optionsLogin = {
  hostname: '127.0.0.1',
  port: 3000,
  path: '/api/auth/login',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length
  }
};

const reqLogin = http.request(optionsLogin, (resLogin) => {
  let loginData = '';
  resLogin.on('data', (chunk) => { loginData += chunk; });
  resLogin.on('end', () => {
    const parsed = JSON.parse(loginData);
    const token = parsed.token;
    
    if (!token) {
        console.log("LOGIN FAILED", loginData);
        return;
    }
    
    const optionsPrev = {
      hostname: '127.0.0.1',
      port: 3000,
      path: '/api/linea/previsualizacion/INS-201-000158868',
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    };
    
    const reqPrev = http.request(optionsPrev, (resPrev) => {
      let prevData = '';
      resPrev.on('data', (chunk) => { prevData += chunk; });
      resPrev.on('end', () => {
        console.log(`STATUS: ${resPrev.statusCode}`);
        console.log(`BODY: ${prevData}`);
      });
    });
    
    reqPrev.end();
  });
});

reqLogin.write(data);
reqLogin.end();
