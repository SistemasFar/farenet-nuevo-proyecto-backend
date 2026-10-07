const fs = require('fs');

const path = 'c:\\Users\\Sistemas2\\Desktop\\farenet nuevo proyecto\\farenetBackend\\modules\\faregas\\services\\faregas-certificados.service.js';
let content = fs.readFileSync(path, 'utf8');

const regex = /const catalogo = catalogoPorClave;/g;
const replacement = `const catalogo = new Map(obtenerCatalogoVariables(configFormato).map((v) => [v.key, v]));`;

if(regex.test(content)) {
    content = content.replace(regex, replacement);
    fs.writeFileSync(path, content, 'utf8');
    console.log('faregas-certificados.service.js fixed successfully.');
} else {
    console.log('Regex did not match.');
}
