const fs = require('fs');
const html = fs.readFileSync('C:\\\\Users\\\\Sistemas2\\\\Desktop\\\\farenet nuevo proyecto\\\\farenetBackend\\\\templates\\\\certificado_inspeccion.html', 'utf8');
const cheerio = require('cheerio');
const $ = cheerio.load(html);
$('[location]').each((i, el) => {
  const loc = $(el).attr('location');
  if (loc.startsWith('analizador-') || loc.startsWith('opacimetro-') || loc.startsWith('sonometro-')) {
    console.log(loc);
  }
});
