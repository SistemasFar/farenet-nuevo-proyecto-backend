const fs = require('fs');

const path = 'c:\\Users\\Sistemas2\\Desktop\\farenet nuevo proyecto\\farenetBackend\\modules\\faregas\\services\\faregas-formatos.variables.js';
let content = fs.readFileSync(path, 'utf8');

const target = /key: 'empresa\.[a-z_]+',[\s\S]*?grupo: 'Empresa',/g;

content = content.replace(target, (match) => {
    return match + `\n    optionalGroup: 'Empresa',`;
});

fs.writeFileSync(path, content, 'utf8');
console.log('faregas-formatos.variables.js patched successfully.');
