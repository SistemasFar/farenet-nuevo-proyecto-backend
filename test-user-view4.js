const service = require('./services/certificadoPreview.service.js');
const cheerio = require('cheerio');
async function run() {
   const vm = await service.buildCertificadoViewModel('INS-100-000123740MM', null);
   const html = await service.renderCertificadoHtml(vm);
   const $ = cheerio.load(html);
   console.log('profundimetro-eje1 text:', $('[location="profundimetro-eje1"]').text());
   console.log('suspension-posteriorDerecha text:', $('[location="suspension-posteriorDerecha"]').text());
   process.exit(0);
}
run();
