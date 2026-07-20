const fs = require('fs');
const html = fs.readFileSync('proof.html', 'utf8');
const cheerio = require('cheerio');
const $ = cheerio.load(html);
console.log('placa:', $('[location="placa"]').text());
console.log('marca:', $('[location="marca"]').text());
console.log('modelo:', $('[location="modelo"]').text());
