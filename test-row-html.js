const service = require('./services/certificadoPreview.service.js');
const cheerio = require('cheerio');
async function run() {
   const vm = await service.buildCertificadoViewModel('INS-100-000123739MM', null);
   const html = await service.renderCertificadoHtml(vm);
   const $ = cheerio.load(html);
   console.log('Row HTML:\n', $('[location="frenos-pesoEje1"]').parent().html());
   process.exit(0);
}
run();
