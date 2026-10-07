const fs = require('fs');

const path = 'c:\\Users\\Sistemas2\\Desktop\\farenet nuevo proyecto\\farenetBackend\\modules\\faregas\\services\\faregas-certificados.service.js';
let content = fs.readFileSync(path, 'utf8');

const regex = /fecha_emision:\s*borrador\.fechaEmision\s*\|\|\s*new Date\(\)\.toISOString\(\)\.slice\(0,\s*10\),/g;
const replacement = `fecha_emision: \`\${fechaDocumento.dia} del mes de \${fechaDocumento.mes.toLowerCase()} del \${fechaDocumento.anio}\`,`;

if(regex.test(content)) {
    content = content.replace(regex, replacement);
    fs.writeFileSync(path, content, 'utf8');
    console.log('faregas-certificados.service.js fixed successfully.');
} else {
    console.log('Regex did not match.');
}
