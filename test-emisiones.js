const fs = require('fs');
const html = fs.readFileSync('proof.html', 'utf8');
const cheerio = require('cheerio');
const $ = cheerio.load(html);
const emisionesHtml = $('[location="analizador-co_r"]').closest('table').html();
console.log(emisionesHtml);
