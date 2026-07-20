const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VybmFtZSI6InRlc3QiLCJpZCI6MSwiaWF0IjoxNzg0NTY0MTU4LCJleHAiOjE3ODQ1Njc3NTh9.y_FDiRicr3JTVWC0eHUZO3PZfOd0WtR6LV7IZQnvj2I';
const nroInspeccion = 'INS-201-000160220'; 
fetch('http://127.0.0.1:3000/api/linea/previsualizacion/' + nroInspeccion, {
   headers: { 'Authorization': 'Bearer ' + token }
}).then(r => r.json()).then(data => {
   if (!data.html) { console.log('ERROR:', data); return; }
   const html = data.html;
   const cheerio = require('cheerio');
   const $ = cheerio.load(html);
   
   console.log('--- API REAL RESPONSE ---');
   console.log('| gridDefecto |', html.includes('class="gridDefecto"') ? 'Sí' : 'No');
   console.log('| Código del defecto |', html.includes('C.2.2.1') ? 'Sí' : 'No');
   console.log('| frenos-pesoEje1 |', html.includes('frenos-pesoEje1') ? 'Sí' : 'No');
   console.log('| Contenido de frenos-pesoEje1 |', $('[location="frenos-pesoEje1"]').text());
}).catch(console.error);
