const fs = require('fs');

const path = 'c:\\Users\\Sistemas2\\Desktop\\farenet nuevo proyecto\\farenetBackend\\modules\\faregas\\services\\faregas-certificados.service.js';
let content = fs.readFileSync(path, 'utf8');

content = content.replace(/tipo: variable\.tipo === 'date' \? 'date' : 'text',\s+requerido: key !== 'inspeccion\.observaciones',\s+valor: valorAnidado\(valoresBase, key\) \?\? ''/, 
`optionalGroup: variable.optionalGroup,
                tipo: variable.tipo === 'date' ? 'date' : 'text',
                requerido: key !== 'inspeccion.observaciones',
                minLength: variable.minLength,
                maxLength: variable.maxLength,
                pattern: variable.pattern,
                patternError: variable.patternError,
                inputMode: variable.inputMode,
                soloDigitos: variable.soloDigitos,
                valor: valorAnidado(valoresBase, key) ?? ''`);

fs.writeFileSync(path, content, 'utf8');
console.log('faregas-certificados.service.js patched successfully.');
