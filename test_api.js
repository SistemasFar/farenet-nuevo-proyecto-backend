const http = require('http');

http.get('http://127.0.0.1:3000/api/maestros/caja', (res) => {
  let data = '';
  res.on('data', (chunk) => data += chunk);
  res.on('end', () => {
    const json = JSON.parse(data);
    console.log(json.data.conceptos.filter(c => c.nombre.toLowerCase().includes('colectivo')));
    console.log(json.data.conceptos.length + " total conceptos");
  });
}).on('error', (err) => console.log(err.message));
