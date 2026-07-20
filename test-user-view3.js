const service = require('./services/certificadoPreview.service.js');
const cheerio = require('cheerio');
async function run() {
   const vm = await service.buildCertificadoViewModel('INS-100-000123740MM', null);
   console.log('Resultados keys:', Object.keys(vm.resultados).length);
   const html = await service.renderCertificadoHtml(vm);
   const $ = cheerio.load(html);
   console.log('frenos-pesoEje1:', $('[location="frenos-pesoEje1"]').text());
   console.log('alineamiento-resultado1:', $('[location="alineamiento-resultado1"]').text());
   process.exit(0);
}
run();
