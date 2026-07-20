const fs = require('fs');
const html = fs.readFileSync('proof.html', 'utf8');
const cheerio = require('cheerio');
const $ = cheerio.load(html);
console.log('alineamiento-resultado1:', $('[location="alineamiento-resultado1"]').text());
console.log('alineamiento-desviacionEje1:', $('[location="alineamiento-desviacionEje1"]').text());
