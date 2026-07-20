const express = require('express');
const CertificadoPreviewService = require('./services/certificadoPreview.service');
const app = express();
app.get('/:id', async (req, res) => {
   const service = new CertificadoPreviewService();
   const html = await service.generarHtmlPrevisualizacion(req.params.id, null);
   res.send(html);
});
app.listen(3001, () => {
   console.log('Test server on 3001');
   const http = require('http');
   http.get('http://127.0.0.1:3001/INS-100-000123739MM', (resp) => {
      let data = '';
      resp.on('data', chunk => data += chunk);
      resp.on('end', () => {
         const hasData = data.includes('530');
         console.log('Did it output 530?', hasData);
         process.exit(0);
      });
   });
});
