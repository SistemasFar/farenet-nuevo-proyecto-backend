const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.resolve('templates', 'certificado_inspeccion.html'), 'utf8');

const regex = /<td[^>]*location="([^"]+)"[^>]*>([\s\S]*?)<\/td>/gi;
let match;
console.log("--- HARDCODED VALUES IN TD ---");
while ((match = regex.exec(html)) !== null) {
  let content = match[2].trim();
  content = content.replace(/<[^>]*>/g, '').trim(); // strip tags
  if (content !== '' && content !== '&nbsp;') {
    console.log(`Location: ${match[1]} | Content: ${content}`);
  }
}

const spanRegex = /<span[^>]*location="([^"]+)"[^>]*>([\s\S]*?)<\/span>/gi;
console.log("--- HARDCODED VALUES IN SPAN ---");
while ((match = spanRegex.exec(html)) !== null) {
  let content = match[2].trim();
  content = content.replace(/<[^>]*>/g, '').trim(); // strip tags
  if (content !== '' && content !== '&nbsp;') {
    console.log(`Location: ${match[1]} | Content: ${content}`);
  }
}
