const fs = require('fs');
const html = fs.readFileSync('proof.html', 'utf8');
const cheerio = require('cheerio');
const $ = cheerio.load(html);
console.log('Row HTML:\n', $('[location="analizador-co_r"]').parent().html());
