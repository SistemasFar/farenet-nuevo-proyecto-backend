const service = require('./services/certificadoPreview.service.js');
const cheerio = require('cheerio');
async function run() {
   const vm = await service.buildCertificadoViewModel('INS-100-000123739MM', null);
   const html = await service.renderCertificadoHtml(vm);
   const $ = cheerio.load(html);
   console.log('Row HTML Eje 2:\n', $('[location="frenos-pesoEje2"]').parent().html());
   process.exit(0);
}
run();
