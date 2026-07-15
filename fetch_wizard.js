const http = require('http');

http.get('http://127.0.0.1:3000/api/linea/wizard/INS-201-000158749', (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    try {
      const parsed = JSON.parse(data);
      console.log("=== RECIBIDAS ===");
      console.log(JSON.stringify(parsed.recibidas, null, 2));
    } catch(e) {
      console.log("Error parsing JSON:", e.message);
      console.log("Raw response:", data.substring(0, 200));
    }
  });
}).on("error", (err) => {
  console.log("Error: " + err.message);
});
