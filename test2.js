const fs = require('fs');
const cheerio = require('cheerio');
const text = fs.readFileSync('test_output.html', 'utf8');
const $ = cheerio.load(text);
const body = $('body').html();
console.log('Body length:', body ? body.length : 0);
console.log('Table count:', $('table').length);
console.log('Class count:', $('.certificado-inspeccion').length);
console.log('Table html:', $('table').first().html());
