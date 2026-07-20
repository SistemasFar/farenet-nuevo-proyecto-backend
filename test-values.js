const fs = require('fs');
const html = fs.readFileSync('proof.html', 'utf8');
const cheerio = require('cheerio');
const $ = cheerio.load(html);
console.log('analizador-co_r:', $('[location="analizador-co_r"]').text());
console.log('luxometro-altaIzquierda:', $('[location="luxometro-altaIzquierda"]').text());
