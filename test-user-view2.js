const service = require('./services/certificadoPreview.service.js');
const db = require('./config/database');
const cheerio = require('cheerio');

async function run() {
   try {
      const nroInspeccion = 'INS-100-000123739MM';
      const vm = await service.buildCertificadoViewModel(nroInspeccion, null);
      
      console.log('vm.defectos length:', vm.defectos ? vm.defectos.length : 'undefined');
      console.log('vm.defectos content:', vm.defectos);
   } catch (e) {
      console.error(e);
   }
   process.exit(0);
}
run();
