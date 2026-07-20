const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

function test() {
  const templatePath = path.resolve(process.cwd(), 'templates', 'certificado_inspeccion.html');
  let rawHtml = fs.readFileSync(templatePath, 'utf8');

  const cantEjes = 5;
  const regexRangeList = /<#assign myRange = 1\.\.cantEjes\s*>\s*<#list myRange as i>([\s\S]*?)<\/#list>/gi;
  rawHtml = rawHtml.replace(regexRangeList, (match, innerContent) => {
    let expanded = '';
    for (let i = 1; i <= cantEjes; i++) {
      let row = innerContent.replace(/\$\{i\}/g, i).replace(/\$\{cantEjes\}/g, cantEjes);
      expanded += row + '\n';
    }
    return expanded;
  });

  rawHtml = rawHtml.replace(/<#assign[^>]*>/gi, '');
  rawHtml = rawHtml.replace(/<#list[^>]*>/gi, '');
  rawHtml = rawHtml.replace(/<\/#list>/gi, '');
  rawHtml = rawHtml.replace(/<#if[^>]*>/gi, '');
  rawHtml = rawHtml.replace(/<\/#if>/gi, '');

  console.log('--- HTML of first frenos-pesoEje1 ---');
  // Check if it exists in rawHtml
  const match1 = rawHtml.match(/location="frenos-pesoEje1"/);
  console.log('Exists in rawHtml:', match1 !== null);

  const $ = cheerio.load(rawHtml);
  console.log('Matches in Cheerio:', $('[location="frenos-pesoEje1"]').length);
}
test();
