const db = require('./config/database');
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const service = require('./services/certificadoPreview.service');

async function run() {
  try {
    const q = `
      SELECT rm.inspeccion_nrodocumentoinspeccion
      FROM resultado_maquina rm
      JOIN maquina m ON rm.maquina_id = m.id
      WHERE m.tipomaquina_key = '3' AND rm.data IS NOT NULL
      ORDER BY rm.id DESC
      LIMIT 1
    `;
    const res = await db.query(q);
    const nroInspeccion = res.rows[0].inspeccion_nrodocumentoinspeccion;
    
    const html = await service.generarHtmlPrevisualizacion(nroInspeccion, null);
    
    console.log('--- HTML DE FRENOS (EJE 1 y 2) ---');
    const $ = cheerio.load(html);
    const $peso1 = $('[location="frenos-pesoEje1"]').parent();
    const $peso2 = $('[location="frenos-pesoEje2"]').parent();
    console.log($peso1.html() ? $peso1.parent().html() : 'NO ENCONTRADO');
    console.log($peso2.html() ? $peso2.parent().html() : 'NO ENCONTRADO');
    
    console.log('--- VALIDACIONES ESTRUCTURALES ---');
    console.log('Filas de frenos (pesoEje1..5):', $('[location^="frenos-pesoEje"]').length);
    console.log('frenos-eficienciaServicio rowspan:', $('[location="frenos-eficienciaServicio"]').length);
    console.log('frenos-resultadoEficienciaFrenosServicio rowspan:', $('[location="frenos-resultadoEficienciaFrenosServicio"]').length);
    console.log('Expresiones ${i}:', html.match(/\$\{i\}/) ? html.match(/\$\{i\}/).length : 0);
    console.log('Expresiones ${cantEjes}:', html.match(/\$\{cantEjes\}/) ? html.match(/\$\{cantEjes\}/).length : 0);
    console.log('Bloques <#if i == 1>:', html.match(/<#if[^>]*>/) ? html.match(/<#if[^>]*>/).length : 0);
    
    let tdsSinTr = 0;
    $('td').each((i, el) => {
       if (el.parent && el.parent.name !== 'tr') tdsSinTr++;
    });
    console.log('Celdas td cuyo padre directo no es tr:', tdsSinTr);

    console.log('--- VALORES REALES ---');
    console.log('frenos-pesoEje1:', $('[location="frenos-pesoEje1"]').html(), '| Coincidencias:', $('[location="frenos-pesoEje1"]').length);
    console.log('frenos-fuerzaFrenadoEjeDerecho1:', $('[location="frenos-fuerzaFrenadoEjeDerecho1"]').html(), '| Coincidencias:', $('[location="frenos-fuerzaFrenadoEjeDerecho1"]').length);

    console.log('--- VALORES GENERALES (Intactos) ---');
    console.log('Placa:', $('[location="placa"]').html());
    console.log('Empresa:', $('[location="empresa"]').html());
    
  } catch (e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
}
run();
