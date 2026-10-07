const fs = require('fs');

const path = 'c:\\Users\\Sistemas2\\Desktop\\farenet nuevo proyecto\\farenetFrontend\\src\\modules\\faregas\\views\\NuevoCertificado\\components\\NuevoCertificado\\TallerStep.tsx';
let content = fs.readFileSync(path, 'utf8');

const regex = /\{\s*formulario\.campos\.length === 0 \? \([\s\S]*?Este formato solo utiliza variables automáticas; no requiere datos manuales en este paso\.[\s\S]*?\) : Object\.entries\(grupos\)\.map\(\(\[grupo, campos\]\) => \([\s\S]*?<\/section>[\s\S]*?\)\)\s*\}/m;

const replacement = `{formulario.campos.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
          Este formato solo utiliza variables automáticas; no requiere datos manuales en este paso.
        </div>
      ) : Object.entries(grupos).map(([grupo, campos]) => {
        const isEmpresa = grupo.toLowerCase() === 'empresa';
        const isEmpresaActiva = valores['__incluir_empresa'] === 'true';

        return (
          <section key={grupo} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 bg-[#f4f9ff] px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h3 className="text-base font-bold capitalize text-slate-800">{grupo}</h3>
                <p className="mt-1 text-xs text-slate-500">Complete los valores que aparecerán en el certificado.</p>
              </div>
              {isEmpresa && (
                <label className="flex items-center gap-2 cursor-pointer bg-white border border-slate-300 px-4 py-2 rounded-lg hover:bg-slate-50 transition-colors">
                  <input
                    type="checkbox"
                    className="w-4 h-4 text-[#052a79] rounded border-slate-300 focus:ring-[#052a79]"
                    checked={isEmpresaActiva}
                    onChange={(e) => setValores((actual) => ({ ...actual, '__incluir_empresa': e.target.checked ? 'true' : 'false' }))}
                  />
                  <span className="text-sm font-semibold text-slate-700">Incluir datos de la empresa</span>
                </label>
              )}
            </div>
            {(!isEmpresa || isEmpresaActiva) && (
              <div className="grid grid-cols-1 gap-5 p-6 md:grid-cols-2 lg:grid-cols-3 animate-fade-in">
                {campos.map((campo) => {
                  const esObservacion = campo.key.includes('observacion');
                  
                  // Validar estado para feedback visual en vivo
                  const valor = valores[campo.key] ?? '';
                  let errorStr = '';
                  if (campo.requerido && !valor.trim()) {
                    errorStr = 'Campo requerido';
                  } else if (valor && campo.minLength && valor.trim().length < campo.minLength) {
                    errorStr = \`Mínimo \${campo.minLength} caracteres\`;
                  } else if (valor && campo.pattern && !new RegExp(campo.pattern).test(valor)) {
                    errorStr = campo.patternError || 'Formato inválido';
                  }

                  const handleChange = (event) => {
                    let val = event.target.value;
                    if (campo.soloDigitos) val = val.replace(/\\D/g, '');
                    if (campo.maxLength) val = val.slice(0, campo.maxLength);
                    setValores((actual) => ({ ...actual, [campo.key]: val }));
                  };

                  return (
                    <div key={campo.key} className={\`flex flex-col gap-1.5 \${esObservacion ? 'md:col-span-2' : ''}\`}>
                      <div className="flex justify-between items-end">
                        <label htmlFor={\`formato-\${campo.key}\`} className="text-xs font-bold capitalize tracking-wider text-slate-600">
                          {campo.label} {campo.requerido && <span className="text-red-500">*</span>}
                        </label>
                        {errorStr && <span className="text-[10px] font-bold text-red-500">{errorStr}</span>}
                      </div>
                      {esObservacion ? (
                        <textarea
                          id={\`formato-\${campo.key}\`}
                          value={valor}
                          onChange={handleChange}
                          maxLength={campo.maxLength}
                          rows={3}
                          className={\`w-full resize-none rounded-xl border-2 bg-white px-4 py-3 text-sm font-semibold transition-all focus:ring-4 focus:ring-blue-50 \${errorStr ? 'border-red-300 text-red-900 focus:border-red-500' : 'border-slate-200 text-slate-700 focus:border-[#052a79]'}\`}
                        />
                      ) : (
                        <input
                          id={\`formato-\${campo.key}\`}
                          type={campo.tipo === 'date' ? 'date' : 'text'}
                          value={valor}
                          onChange={handleChange}
                          inputMode={campo.inputMode}
                          maxLength={campo.maxLength}
                          className={\`h-11 w-full rounded-xl border-2 bg-white px-4 text-sm font-semibold transition-all focus:ring-4 focus:ring-blue-50 \${errorStr ? 'border-red-300 text-red-900 focus:border-red-500' : 'border-slate-200 text-slate-700 focus:border-[#052a79]'}\`}
                        />
                      )}
                      <div className="flex justify-between">
                        <span className="font-mono text-[10px] text-slate-400">{\`{{\${campo.key}}}\`}</span>
                        {campo.maxLength && <span className="text-[10px] text-slate-400">{valor.length}/{campo.maxLength}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}`;

if(regex.test(content)) {
    content = content.replace(regex, replacement);
    fs.writeFileSync(path, content, 'utf8');
    console.log('TallerStep.tsx patched successfully.');
} else {
    console.log('Regex did not match.');
}
