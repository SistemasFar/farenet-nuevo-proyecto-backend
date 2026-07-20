const service = require('./services/certificadoPreview.service.js');
const cheerio = require('cheerio');
async function run() {
   try {
      const nroInspeccion = 'INS-201-000160220'; // This is what the user screenshotted (from before). If it fails, I'll check others.
      console.log('Testing', nroInspeccion);
      const vm = await service.buildCertificadoViewModel(nroInspeccion, null);
      
      console.log('ID recibido en el endpoint:', nroInspeccion);
      console.log('nroInspeccion resuelto:', vm.cabecera?.inspeccion?.nrodocumentoinspeccion);
      console.log('cantidad de claves en vm.resultados:', Object.keys(vm.resultados).length);
      console.log('vm.resultados["frenos-pesoEje1"]:', vm.resultados['frenos-pesoEje1']);
      console.log('vm.resultados["frenos-fuerzaFrenadoEjeDerecho1"]:', vm.resultados['frenos-fuerzaFrenadoEjeDerecho1']);
      console.log('cantidad final de vm.defectos:', vm.defectos?.length);
      
      const html = await service.renderCertificadoHtml(vm);
      const $ = cheerio.load(html);
      
      console.log('| Elemento buscado | Existe en la respuesta real | Valor encontrado |');
      console.log('|---|---|---|');
      console.log('| gridDefecto |', html.includes('class="gridDefecto"') ? 'Sí' : 'No', '| |');
      console.log('| Código del defecto |', html.includes(vm.defectos?.[0]?.codigovalor) ? 'Sí' : 'No', '|', vm.defectos?.[0]?.codigovalor, '|');
      console.log('| Descripción del defecto |', html.includes(vm.defectos?.[0]?.nombrevalor) ? 'Sí' : 'No', '|', vm.defectos?.[0]?.nombrevalor, '|');
      console.log('| frenos-pesoEje1 |', html.includes('frenos-pesoEje1') ? 'Sí' : 'No', '| |');
      console.log('| Contenido de frenos-pesoEje1 | |', $('[location="frenos-pesoEje1"]').text(), '|');
      console.log('| frenos-fuerzaFrenadoEjeDerecho1 |', html.includes('frenos-fuerzaFrenadoEjeDerecho1') ? 'Sí' : 'No', '| |');
      console.log('| Contenido final | |', $('[location="frenos-fuerzaFrenadoEjeDerecho1"]').text(), '|');
      
   } catch (e) {
      console.error(e);
   }
   process.exit(0);
}
run();
