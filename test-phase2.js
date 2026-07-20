const db = require('./config/database');
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const service = require('./services/certificadoPreview.service');

async function run() {
  try {
    // Buscar una inspección con observaciones y mapaNormas
    const q = `
      SELECT rm.inspeccion_nrodocumentoinspeccion
      FROM resultado_maquina rm
      JOIN resultado_maquina_defecto rmd ON rmd.resultado_maquina_id = rm.id
      WHERE rm.data::text LIKE '%mapaNormas%'
      ORDER BY rm.id DESC
      LIMIT 1
    `;
    let res = await db.query(q);
    
    // Si no hay con ambas, buscar una con al menos defectos
    if (res.rows.length === 0) {
       res = await db.query('SELECT inspeccion_nrodocumentoinspeccion FROM resultado_maquina_defecto rmd JOIN resultado_maquina rm ON rm.id = rmd.resultado_maquina_id ORDER BY rm.id DESC LIMIT 1');
    }
    const nroInspeccion = res.rows[0].inspeccion_nrodocumentoinspeccion;
    
    // Validar deduplicación directamente llamando a la BD y comprobando
    const qDefectos = `
      SELECT d.codigovalor, d.nombrevalor, d.nivelpeligro 
      FROM resultado_maquina rm 
      JOIN resultado_maquina_defecto rmd ON rmd.resultado_maquina_id = rm.id 
      JOIN defecto d ON d.id = rmd.defectos_id 
      WHERE rm.inspeccion_nrodocumentoinspeccion = $1
    `;
    const resDefectos = await db.query(qDefectos, [nroInspeccion]);
    const defectosDirectos = resDefectos.rows.length;

    const normalizarJson = (value) => {
      if (value == null) return {};
      if (typeof value === 'object' && !Array.isArray(value)) return value;
      if (typeof value === 'string' && value.trim() !== '') {
        try {
          const parsed = JSON.parse(value);
          return parsed && typeof parsed === 'object' ? parsed : {};
        } catch { return {}; }
      }
      return {};
    };

    const qResultados = `SELECT data FROM resultado_maquina WHERE inspeccion_nrodocumentoinspeccion = $1`;
    const resultados = await db.query(qResultados, [nroInspeccion]);
    const normaIdsMap = new Map();
    for (const row of resultados.rows) {
       const parsedData = normalizarJson(row.data);
       if (parsedData.mapaNormas) {
           for (const [normaIdStr, severidad] of Object.entries(parsedData.mapaNormas)) {
               const nId = Number(normaIdStr);
               if (Number.isSafeInteger(nId) && nId > 0) {
                   normaIdsMap.set(nId, severidad);
               }
           }
       }
    }
    const normasMapa = normaIdsMap.size;
    const antesDeduplicar = defectosDirectos + normasMapa;

    const vm = await service.buildCertificadoViewModel(nroInspeccion, null);
    
    const obsManualAgregada = vm.defectos.some(d => d.codigovalor === '' && d.nombrevalor !== '');
    
    const html = await service.renderCertificadoHtml(vm);
    const $ = cheerio.load(html);
    const filasHTML = $('.gridDefecto tbody tr').length;
    
    console.log('--- VALIDACION FASE 2 ---');
    console.log('Inspección de prueba:', nroInspeccion);
    console.log('Cantidad de defectos directos:', defectosDirectos);
    console.log('Cantidad de normas obtenidas desde mapaNormas:', normasMapa);
    console.log('Cantidad antes de deduplicar:', antesDeduplicar);
    console.log('Cantidad después de deduplicar:', vm.defectos.length - (obsManualAgregada ? 1 : 0));
    console.log('¿Se agregó observación manual?:', obsManualAgregada ? 'Sí' : 'No');
    console.log('Cantidad final de filas HTML:', filasHTML);
    console.log('Quedan expresiones ${defecto...} en HTML?:', html.includes('${defecto') ? 'Sí' : 'No');
    console.log('¿Fase 1 intacta (frenos-pesoEje1 expandido y sin variables)?:', !html.includes('${i}') && $('[location="frenos-pesoEje1"]').length === 1 ? 'Sí' : 'No');
    
  } catch (e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
}
run();
