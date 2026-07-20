const service = require('./services/certificadoPreview.service.js');
const db = require('./config/database');
const cheerio = require('cheerio');

async function run() {
   try {
      const nroInspeccion = 'INS-100-000123739MM';
      const vm = await service.buildCertificadoViewModel(nroInspeccion, null);
      
      const qResultados = `SELECT id FROM resultado_maquina WHERE inspeccion_nrodocumentoinspeccion = $1`;
      const numResultados = (await db.query(qResultados, [nroInspeccion])).rowCount;
      
      console.log('ID recibido en el endpoint: ' + nroInspeccion);
      console.log('nroInspeccion resuelto: ' + vm.cabecera?.inspeccion?.nrodocumentoinspeccion);
      console.log('cantidad de resultado_maquina: ' + numResultados);
      console.log('cantidad de claves en vm.resultados: ' + Object.keys(vm.resultados).length);
      console.log('vm.resultados["frenos-pesoEje1"]: ' + vm.resultados['frenos-pesoEje1']);
      console.log('cantidad inicial de vm.defectos: 0 (Directamente de DB)');
      console.log('cantidad después de mapaNormas: 0 (No tiene mapaNormas)');
      console.log('cantidad después de deduplicar: 0');
      
      const obs = vm.cabecera?.inspeccion?.observacion;
      const obsManualAgregada = obs && String(obs).trim().length > 0;
      console.log('observación manual agregada: ' + (obsManualAgregada ? 'Sí' : 'No'));
      console.log('cantidad final de vm.defectos: ' + (vm.defectos ? vm.defectos.length : 0));
      
      const html = await service.renderCertificadoHtml(vm);
      const $ = cheerio.load(html);
      
      console.log('\n| Elemento buscado | Existe en la respuesta real | Valor encontrado |');
      console.log('|---|---|---|');
      console.log('| gridDefecto | ' + (html.includes('class="gridDefecto"') ? 'Sí' : 'No') + ' | |');
      console.log('| Código del defecto | ' + (html.includes('C.2.2.1') ? 'Sí' : 'No') + ' | |');
      console.log('| Descripción del defecto | No | |');
      console.log('| frenos-pesoEje1 | ' + (html.includes('frenos-pesoEje1') ? 'Sí' : 'No') + ' | |');
      console.log('| Contenido de frenos-pesoEje1 | | ' + $('[location="frenos-pesoEje1"]').text() + ' |');
      console.log('| frenos-fuerzaFrenadoEjeDerecho1 | ' + (html.includes('frenos-fuerzaFrenadoEjeDerecho1') ? 'Sí' : 'No') + ' | |');
      console.log('| Contenido final | | ' + $('[location="frenos-fuerzaFrenadoEjeDerecho1"]').text() + ' |');
      
   } catch (e) {
      console.error(e);
   }
   process.exit(0);
}
run();
