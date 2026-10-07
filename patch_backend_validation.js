const fs = require('fs');

const path = 'c:\\Users\\Sistemas2\\Desktop\\farenet nuevo proyecto\\farenetBackend\\modules\\faregas\\services\\faregas-certificados.service.js';
let content = fs.readFileSync(path, 'utf8');

const regex = /const variablesRequeridas = \[\.\.\.new Set\(\[\.\.\.variablesConfiguradas, \.\.\.variablesHtml\][\s\S]*?\.filter\(\(key\) => !esVariableFormatoAutomatica\(key\) && key !== 'inspeccion\.observaciones'\);\s*variablesRequeridas\.forEach\(\(key\) => \{\s*const valor = valorAnidado\(cert\.formato_datos_snapshot \|\| \{\}, key\);\s*if \(valor === null \|\| valor === undefined \|\| String\(valor\)\.trim\(\) === ''\) \{\s*pushError\('formato', key, 'CAMPO_REQUERIDO', \`Complete \$\{key\}\`\);\s*\}\s*\}\);/m;

const replacement = `const isEmpresaActiva = (cert.formato_datos_snapshot || {})['__incluir_empresa'] === 'true';
    const variablesRequeridas = [...new Set([...variablesConfiguradas, ...variablesHtml]
        .map((key) => String(key || '').trim())
        .filter((key) => CLAVE_VARIABLE_FORMATO.test(key)))]
        .filter((key) => !esVariableFormatoAutomatica(key) && key !== 'inspeccion.observaciones');

    const catalogo = catalogoPorClave;
    
    variablesRequeridas.forEach((key) => {
        const metadata = catalogo.get(key) || {};
        
        if (metadata.optionalGroup && metadata.optionalGroup.toLowerCase() === 'empresa' && !isEmpresaActiva) {
            return;
        }

        const valorRaw = valorAnidado(cert.formato_datos_snapshot || {}, key);
        const valor = valorRaw === null || valorRaw === undefined ? '' : String(valorRaw).trim();

        if (!valor) {
            pushError('formato', key, 'CAMPO_REQUERIDO', \`Complete \${key}\`);
        } else {
            if (metadata.minLength && valor.length < metadata.minLength) {
                pushError('formato', key, 'LONGITUD_INVALIDA', \`\${metadata.label}: mínimo \${metadata.minLength} caracteres\`);
            }
            if (metadata.pattern && !new RegExp(metadata.pattern).test(valor)) {
                pushError('formato', key, 'FORMATO_INVALIDO', \`\${metadata.label}: \${metadata.patternError || 'formato inválido'}\`);
            }
        }
    });`;

if(regex.test(content)) {
    content = content.replace(regex, replacement);
    fs.writeFileSync(path, content, 'utf8');
    console.log('faregas-certificados.service.js patched correctly.');
} else {
    console.log('Regex did not match.');
}
