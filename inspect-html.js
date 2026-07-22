const db = require('./config/database');
const CertificadoPreviewService = require('./services/certificadoPreview.service.js');
const cheerio = require('cheerio');
const fs = require('fs');

async function run() {
  try {
    const res = await db.query("SELECT inspeccion_nrodocumentoinspeccion FROM resultado_maquina LIMIT 1");
    let nro = res.rows[0].inspeccion_nrodocumentoinspeccion;
    
    console.log('Inspecting: ', nro);
    const html = await CertificadoPreviewService.generarHtmlPrevisualizacion(nro, { username: 'system' });
    const $ = cheerio.load(html);
    console.log('Bloques principales (.certificado-inspeccion):', $('.certificado-inspeccion').length, $('.certificado-inspeccion').attr('style'));
    console.log('page-breaker (.page-breaker):', $('.page-breaker').length, $('.page-breaker').attr('style'));
    console.log('Contenedor foto (.foto):', $('.foto').length, $('.foto').attr('style'));
    console.log('Contenedor texto legal (.texto-legal):', $('.texto-legal').length, $('.texto-legal').attr('style'));
    console.log('Contenedor tabla-container (.tabla-container):', $('.tabla-container').length, $('.tabla-container').attr('style'));
    
    // Inspect specific containers
    const absoluteEls = $('*').filter((i, el) => {
        const style = $(el).attr('style');
        return style && style.includes('absolute');
    }).length;
    console.log('Elements with absolute positioning:', absoluteEls);

    const negativeMarginEls = $('*').filter((i, el) => {
        const style = $(el).attr('style');
        return style && style.match(/margin-[a-z]+:\s*-[0-9]+px/);
    }).length;
    console.log('Elements with negative margins:', negativeMarginEls);

    fs.writeFileSync('test-html.html', html);
  } catch (e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
}
run();
