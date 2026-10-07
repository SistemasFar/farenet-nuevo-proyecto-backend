const fs = require('fs');

const path = 'c:\\Users\\Sistemas2\\Desktop\\farenet nuevo proyecto\\farenetFrontend\\src\\modules\\faregas\\views\\NuevoCertificado\\faregas-wizard.validation.ts';
let content = fs.readFileSync(path, 'utf8');

const regex = /export const validarFormularioFormatoDinamico = \([\s\S]*?\)\s*=>\s*campos[\s\S]*?\.map\(\(campo\) => `Complete \$\{campo\.label\.toLocaleLowerCase\('es-PE'\)\}\.`\);/m;

const replacement = `export const validarFormularioFormatoDinamico = (
  campos: CampoFormatoDinamicoFaregas[],
  valores: Record<string, string>
) => {
  const isEmpresaActiva = valores['__incluir_empresa'] === 'true';
  const errores: string[] = [];

  for (const campo of campos) {
    if (campo.optionalGroup?.toLowerCase() === 'empresa' && !isEmpresaActiva) {
      continue;
    }

    const valor = String(valores[campo.key] ?? '').trim();

    if (campo.requerido && !valor) {
      errores.push(\`Complete \${campo.label.toLocaleLowerCase('es-PE')}.\`);
      continue;
    }

    if (valor) {
      if (campo.minLength && valor.length < campo.minLength) {
        errores.push(\`\${campo.label}: mínimo \${campo.minLength} caracteres.\`);
      }
      if (campo.pattern && !new RegExp(campo.pattern).test(valor)) {
        errores.push(\`\${campo.label}: \${campo.patternError || 'formato inválido'}\`);
      }
    }
  }

  return errores;
};`;

if(regex.test(content)) {
    content = content.replace(regex, replacement);
    fs.writeFileSync(path, content, 'utf8');
    console.log('faregas-wizard.validation.ts patched successfully.');
} else {
    console.log('Regex did not match.');
}
